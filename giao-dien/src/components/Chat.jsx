import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getConversations, addMessage, sendToAI, getStudent } from '../services/api';
import ConfirmModal from './ConfirmModal';
import '../styles/chat.css';
import { marked } from 'marked';
import { FiMenu } from 'react-icons/fi';

const Chat = ({ mode, userId, studentId, token, currentSession, setCurrentSession, aiEnabled, sidebarCollapsed, setCollapsedGlobal }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAiResponding, setIsAiResponding] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedLink, setSelectedLink] = useState('');
  const ws = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const navigate = useNavigate();
  const sessionRef = useRef(currentSession);
  const messagesEndRef = useRef(null);
  const chatWindowRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAiResponding]);

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

  const toggleSidebar = () => {
    if (setCollapsedGlobal) {
      setCollapsedGlobal(!sidebarCollapsed);
    }
  };

  const connectWebSocket = () => {
    if (!currentSession || !token) {
      console.log('Missing currentSession or token, skipping WebSocket connection');
      return;
    }
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      console.log(`WebSocket already open for session_id: ${currentSession}`);
      return;
    }
    const wsUrl = import.meta.env.VITE_API_URL
      ? `${import.meta.env.VITE_API_URL.replace(/https?:\/\//, 'wss://').replace(/\/+$/, '')}/ws/${currentSession}/${token}`
      : `ws://localhost:8000/ws/${currentSession}/${token}`;
    ws.current = new WebSocket(wsUrl);
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

  // Handle link clicks
  useEffect(() => {
    const chatWindow = chatWindowRef.current;
    if (!chatWindow) return;

    const handleLinkClick = (e) => {
      if (e.target.tagName === 'A') {
        e.preventDefault();
        const href = e.target.getAttribute('href');
        if (href) {
          setSelectedLink(href);
          setShowLinkModal(true);
        }
      }
    };

    chatWindow.addEventListener('click', handleLinkClick);
    return () => {
      chatWindow.removeEventListener('click', handleLinkClick);
    };
  }, []);

  marked.setOptions({
    breaks: true,
    gfm: true,
    renderer: new marked.Renderer(),
  });

  const handleSend = async () => {
    if (!input || !currentSession || !token) {
      if (!currentSession) {
        alert('Vui lòng chọn hoặc tạo một phiên chat mới.');
      } else {
        alert('Không thể kết nối với server. Vui lòng thử lại.');
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
      setIsAiResponding(true);
      await addMessage(message, token);
      if (mode === 'Học sinh') {
        setMessages((prev) => {
          if (prev.some(msg => msg.timestamp === message.timestamp && msg.content === message.content)) {
            return prev;
          }
          return [...prev, { ...message, rendered: marked.parse(message.content) }];
        });
      }

      if (mode === 'Học sinh' && aiEnabled) {
        const aiRequest = {
          messages: [...messages, aiMessage].map(msg => ({
            role: msg.role || 'user',
            content: msg.content || '',
            timestamp: msg.timestamp || new Date().toISOString(),
          })),
          session_id: currentSession,
          ai_enabled: true,
        };
        console.log('Sending aiRequest to /chatbot:', JSON.stringify(aiRequest, null, 2));
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
            console.log('Đã reload hội thoại hoàn chỉnh từ DB');
          } catch (err) {
            console.error('Lỗi reload hội thoại:', err);
          }
        }, 300);
      }
      setInput('');
    } catch (err) {
      console.error('Send message error:', err.message, err.response?.status, err.response?.data);
      setMessages((prev) => [
        ...prev,
        {
          session_id: currentSession,
          role: 'assistant',
          content: `Lỗi: Không thể nhận phản hồi từ AI. Vui lòng thử lại sau. 😔`,
          timestamp: new Date().toISOString(),
          rendered: marked.parse(`Lỗi: Không thể nhận phản hồi từ AI. Vui lòng thử lại sau. 😔`),
        },
      ]);
    } finally {
      setIsAiResponding(false);
    }
  };

  const handleLinkConfirm = () => {
    if (selectedLink) {
      window.open(selectedLink, '_blank', 'noopener,noreferrer');
    }
    setShowLinkModal(false);
    setSelectedLink('');
  };

  const handleLinkCancel = () => {
    setShowLinkModal(false);
    setSelectedLink('');
  };

  return (
    <div className="main">
      <div className={`chat-container ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="chat-header">
          <button
            className="mobile-toggle-btn"
            onClick={toggleSidebar}
          >
            <FiMenu size={24} />
          </button>
          {userInfo && (
            <span className="greeting">
              {mode === 'Học sinh'
                ? `Chào em ${userInfo.name} lớp ${userInfo.class}`
                : `Chat với ${userInfo.name} lớp ${userInfo.class}`}
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
        <div className="chat-window" ref={chatWindowRef}>
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
              <div ref={messagesEndRef} />
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
        <ConfirmModal
          show={showLinkModal}
          message={`Bạn có muốn mở liên kết "${selectedLink}" trong tab mới không?`}
          onConfirm={handleLinkConfirm}
          onCancel={handleLinkCancel}
        />
      </div>
    </div>
  );
};

export default Chat;