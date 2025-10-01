import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getConversations, addMessage, sendToAI, getStudent } from '../services/api';
import '../styles/chat.css';
import { marked } from 'marked';

const Chat = ({ mode, userId, studentId, token, currentSession, setCurrentSession, aiEnabled, sidebarCollapsed }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAiResponding, setIsAiResponding] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const ws = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const navigate = useNavigate();
  const sessionRef = useRef(currentSession);

  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        if (mode === 'Học sinh') {
          const response = await getStudent(userId, token);
          setUserInfo(response.data);
        } else {
          const response = await getStudent(studentId, token);
          setUserInfo(response.data);
        }
      } catch (err) {
        console.error('Error fetching user info:', err);
        if (err.response?.status === 401) navigate('/login');
      }
    };
    if (userId && token) fetchUserInfo();
  }, [userId, token, mode, navigate, studentId]);

  const connectWebSocket = () => {
    if (!currentSession || !token) {
      console.log('Missing currentSession or token, skipping WebSocket connection');
      return;
    }
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      console.log(`WebSocket already open for session_id: ${currentSession}`);
      return;
    }
    ws.current = new WebSocket(`ws://localhost:8000/ws/${currentSession}/${token}`);
    ws.current.onopen = () => {
      console.log(`WebSocket connected for session_id: ${currentSession}`);
      reconnectAttempts.current = 0;
    };
    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket received:', data);
        if (data.type === 'ping') return;
        if (data.session_id !== currentSession) return;

        if (data.role === 'user' || data.role === 'teacher') {
          setMessages((prev) => {
            if (prev.some(msg => msg.timestamp === data.timestamp && msg.content === data.content)) return prev;
            return [...prev, { 
              ...data, 
              session_id: currentSession, 
              content: data.content.replace('<br>', '\n'), 
              rendered: marked.parse(data.content) 
            }];
          });
        } else {
          console.log('Ignoring assistant message from WebSocket:', data.content);
        }
      } catch (err) {
        console.error('WebSocket message parsing error:', err);
      }
    };
    ws.current.onclose = (event) => {
      console.log(`WebSocket closed for session_id ${currentSession}:`, event);
      if (event.code === 1008) {
        navigate('/login');
        return;
      }
      if (reconnectAttempts.current < maxReconnectAttempts) {
        setTimeout(() => {
          reconnectAttempts.current += 1;
          console.log(`Reconnecting WebSocket, attempt ${reconnectAttempts.current}`);
          connectWebSocket();
        }, 1000 * (reconnectAttempts.current + 1));
      } else {
        setMessages((prev) => [
          ...prev,
          {
            session_id: currentSession,
            role: 'assistant',
            content: 'Không thể kết nối với server. Vui lòng thử lại sau. 😔',
            timestamp: new Date().toISOString(),
            rendered: marked.parse('Không thể kết nối với server. Vui lòng thử lại sau. 😔'),
          },
        ]);
      }
    };
    ws.current.onerror = (err) => {
      console.error(`WebSocket error for session_id: ${currentSession}`, err);
      ws.current.close();
    };
  };

  useEffect(() => {
    if (!currentSession && mode === 'Học sinh') {
      setMessages([]);
      setIsLoading(false);
      return;
    }
    if (currentSession && token) {
      if (sessionRef.current !== currentSession) {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) ws.current.close();
        sessionRef.current = currentSession;
        reconnectAttempts.current = 0;
      }
      setIsLoading(true);
      const timeout = setTimeout(() => {
        connectWebSocket();
        getConversations(currentSession, token)
          .then((res) => {
            const uniqueMessages = res.data.filter(
              (msg, index, self) =>
                index === self.findIndex((m) => m.timestamp === msg.timestamp && m.content === msg.content)
            );
            setMessages(uniqueMessages.map((msg) => ({
              ...msg,
              content: msg.content.replace('<br>', '\n'),
              rendered: marked.parse(msg.content)
            })));
            setIsLoading(false);
          })
          .catch((err) => {
            console.error('Fetch conversations error:', err);
            setIsLoading(false);
            if (err.response?.status === 401) navigate('/login');
          });
      }, 500);
      return () => {
        clearTimeout(timeout);
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.close();
        }
      };
    }
  }, [currentSession, token, mode, studentId, navigate]);

  marked.setOptions({
    breaks: true,
    gfm: true,
    renderer: new marked.Renderer(),
  });

  const handleSend = async () => {
    if (!input || !currentSession || !token || !ws.current || ws.current.readyState !== WebSocket.OPEN) {
      if (!currentSession) {
        alert('Vui lòng chọn hoặc tạo một phiên chat mới.');
      }
      return;
    }
    const timestamp = new Date().toISOString();
    const message = {
      session_id: currentSession,
      role: mode === 'Học sinh' ? 'user' : 'teacher',
      content: input,
      timestamp,
    };
    const aiMessage = { role: message.role, content: input, timestamp };

    try {
      await addMessage(message, token);
      ws.current.send(JSON.stringify(message));
      if (mode === "Học sinh") {
        setMessages((prev) => [...prev, { ...message, rendered: marked.parse(message.content) }]);
      }

      if (mode === 'Học sinh' && aiEnabled) {
        setIsAiResponding(true);
        const aiRequest = {
          messages: [...messages, aiMessage],
          session_id: currentSession,
          ai_enabled: true,
        };
        const response = await sendToAI(aiRequest, token);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let aiResponse = '';
        const aiTimestamp = new Date().toISOString();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          console.log('SSE chunk:', chunk);
          const lines = chunk.split('\n\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (!data || data === '[DONE]' || data.startsWith('SOURCE_LANG')) continue;
              aiResponse += data;
            }
          }
        }

        aiResponse = aiResponse.trim();
        console.log('Final AI response:', aiResponse);
        setMessages((prev) => [
          ...prev,
          {
            session_id: currentSession,
            role: 'assistant',
            content: aiResponse,
            rendered: marked.parse(aiResponse),
            timestamp: aiTimestamp,
          },
        ]);
        setIsAiResponding(false);
        setTimeout(async () => {
          try {
            const res = await getConversations(currentSession, token);
            const uniqueMessages = res.data.filter(
              (msg, index, self) =>
                index === self.findIndex((m) => m.timestamp === msg.timestamp && m.content === msg.content)
            );
            setMessages(uniqueMessages.map((msg) => ({
              ...msg,
              content: msg.content.replace('<br>', '\n'),
              rendered: marked.parse(msg.content)
            })));
            console.log("Đã reload hội thoại hoàn chỉnh từ DB");
          } catch (err) {
            console.error("Lỗi reload hội thoại:", err);
          }
        }, 300);
      }
      setInput('');
    } catch (err) {
      console.error('Send message error:', err);
      setIsAiResponding(false);
      if (err.response?.status === 401) navigate('/login');
      else
        setMessages((prev) => [
          ...prev,
          {
            session_id: currentSession,
            role: 'assistant',
            content: `Lỗi: ${err.message}. 😔`,
            timestamp: new Date().toISOString(),
            rendered: marked.parse(`Lỗi: ${err.message}. 😔`),
          },
        ]);
    }
  };

  return (
    <div className="main">
      <div className={`chat-container ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="chat-header">
          {userInfo && (
            <span  className="greeting">
              {mode === 'Học sinh'
                ? `Chào em ${userInfo.name} lớp ${userInfo.class}`
                : ``}

            </span>
          )}
          {mode === 'Giáo viên' && (
            <button
              className="back-btn"
              onClick={() => {
                try {
                  if (ws.current && ws.current.readyState === WebSocket.OPEN) {
                    ws.current.onclose = null;
                    ws.current.close();
                  }
                } catch (e) {
                  console.warn("WebSocket close error:", e);
                }
                navigate('/teacher', { replace: true });
              }}
            >
              ⬅ Quay lại
            </button>
          )}
        </div>
        <div className="chat-window">
          {isLoading ? (
            <div className="text-center text-gray-500">Đang tải tin nhắn...</div>
          ) : !currentSession ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <p className="text-lg font-medium">Hôm nay em muốn hỏi cô Hương gì nhỉ? 😊</p>
              <p>Tạo một phiên chat mới để bắt đầu!</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <p className="text-lg font-medium">Hôm nay em muốn hỏi cô Hương gì nhỉ? 😊</p>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <div
                  key={`${msg.timestamp}-${idx}`}
                  className={`chat-message ${msg.role === 'user' ? 'user' : 'assistant'}`}
                >
                  {msg.role === 'user'
                    ? '👦 Học sinh: '
                    : msg.role === 'assistant'
                    ? '👩‍🏫 Cô Hương (AI): '
                    : '👩‍🏫 Cô Hương: '}
                  <div
                    className="message-content"
                    dangerouslySetInnerHTML={{ __html: msg.rendered || marked.parse(msg.content || '') }}
                  />
                </div>
              ))}
              {isAiResponding && (
                <div className="chat-message assistant">
                  👩‍🏫 Cô Hương (AI): <div className="message-content">Đang suy nghĩ...</div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="input-container">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === 'Học sinh' ? 'Nhập câu hỏi...' : 'Nhập tin nhắn...'}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={!currentSession}
          />
          <button className="send" onClick={handleSend} disabled={isAiResponding || !currentSession}>
            Gửi
          </button>
          <button
            className="refresh"
            onClick={() => {
              if (!currentSession) return;
              setIsLoading(true);
              getConversations(currentSession, token)
                .then((res) => {
                  const uniqueMessages = res.data.filter(
                    (msg, index, self) =>
                      index === self.findIndex((m) => m.timestamp === msg.timestamp && m.content === msg.content)
                  );
                  setMessages(uniqueMessages.map((msg) => ({
                    ...msg,
                    content: msg.content.replace('<br>', '\n'),
                    rendered: marked.parse(msg.content)
                  })));
                  setIsLoading(false);
                })
                .catch((err) => {
                  console.error('Refresh error:', err);
                  setIsLoading(false);
                });
            }}
            disabled={!currentSession}
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;