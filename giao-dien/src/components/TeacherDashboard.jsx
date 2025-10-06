import { useState, useEffect, useRef } from 'react';
import {
  getStudents,
  getUnread,
  getLastMessage,
  getSessions,
  getConversations,
  markRead,
  getStudent
} from '../services/api';
import Chat from './Chat';
import ConfirmModal from './ConfirmModal';
import '../styles/teacher-dashboard.css';
import { FiRefreshCcw, FiFilter, FiMessageCircle } from 'react-icons/fi';
import { useNavigate, useLocation } from 'react-router-dom';

const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const wsUrl = backendUrl
  .replace('https://', 'wss://')
  .replace('http://', 'ws://');

const formatDate = (isoString) => {
  if (!isoString || typeof isoString !== 'string') return 'Chưa có tin nhắn';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return 'Chưa có tin nhắn';
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).replace(',', '');
};

const TeacherDashboard = ({ userId, aiEnabled, setAiEnabled, token, handleLogout, sidebarCollapsed }) => {
  const [students, setStudents] = useState([]);
  const [filters, setFilters] = useState({ name: '', class: '', gvcn: '' });
  const [view, setView] = useState('home');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [studentsPerPage] = useState(5); // 5 students per page
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalStudentId, setModalStudentId] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const ws = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const fetchStudents = async () => {
    if (!token) return;
    try {
      const res = await getStudents(token);
      const updated = await Promise.all(
        res.data.map(async (s) => {
          const sessionsRes = await getSessions(s.id, token);
          const sessions = sessionsRes.data;
          let hasMessages = false;
          let unreadStatus = 'Chưa nhắn';
          let lastMessageTime = null;

          if (sessions.length > 0) {
            for (const session of sessions) {
              const conversationsRes = await getConversations(session.id, token);
              if (conversationsRes.data.length > 0) {
                hasMessages = true;
                break;
              }
            }

            if (hasMessages) {
              const unread = await getUnread(s.id, token);
              const last = await getLastMessage(s.id, token);
              unreadStatus = unread.data.unread ? 'Chưa đọc' : 'Đã đọc';
              lastMessageTime = last.data.last_time;
            }
          }

          return {
            ...s,
            unread: unreadStatus,
            last_time: lastMessageTime,
            hasMessages,
          };
        })
      );
      // Sort students by status priority
      const sortedStudents = updated.sort((a, b) => {
        const priority = { 'Chưa đọc': 1, 'Đã đọc': 2, 'Chưa nhắn': 3 };
        return priority[a.unread] - priority[b.unread];
      });
      setStudents(sortedStudents);
      setCurrentPage(1); // Reset to first page when students are fetched
    } catch (err) {
      console.error('Fetch students error:', err);
      if (err.response?.status === 401) window.location.href = '/login';
    }
  };

  const connectWebSocket = () => {
    if (!token || !userId) {
      console.log('Missing token or userId, skipping WebSocket connection');
      return;
    }
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      console.log(`WebSocket already open for teacherId: ${userId}`);
      return;
    }
    const backendUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
    const wsUrl = backendUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');
    ws.current = new WebSocket(`${wsUrl}/ws/teacher/${userId}/${token}`);

    ws.current.onopen = () => {
      console.log(`WebSocket connected for teacherId: ${userId}`);
      reconnectAttempts.current = 0;
    };
    ws.current.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket received:', data);
        if (data.type === 'ping') return;

        if (data.type === 'new_message') {
          const { studentId, sessionId, lastMessageTime } = data;
          // Fetch student name for the modal
          const studentRes = await getStudent(studentId, token);
          const studentName = studentRes.data.name || 'Học sinh';
          // Show modal notification
          setModalMessage(`Có tin nhắn mới chưa đọc từ ${studentName}`);
          setModalStudentId(studentId);
          setShowModal(true);
          // Update student state
          setStudents((prev) => {
            const updatedStudents = prev.map((s) =>
              s.id === studentId
                ? {
                    ...s,
                    unread: 'Chưa đọc',
                    last_time: lastMessageTime,
                    hasMessages: true,
                  }
                : s
            );
            // Re-sort students after updating status
            return updatedStudents.sort((a, b) => {
              const priority = { 'Chưa đọc': 1, 'Đã đọc': 2, 'Chưa nhắn': 3 };
              return priority[a.unread] - priority[b.unread];
            });
          });
        }
      } catch (err) {
        console.error('WebSocket message parsing error:', err);
      }
    };
    ws.current.onclose = (event) => {
      console.log('WebSocket closed:', event);
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
      }
    };
    ws.current.onerror = (err) => {
      console.error('WebSocket error:', err);
      ws.current.close();
    };
  };

  useEffect(() => {
    fetchStudents();
    connectWebSocket();

    return () => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.close();
      }
    };
  }, [token, location.pathname]);

  const handleFilter = (e) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
    setCurrentPage(1); // Reset to first page when filters change
  };

  const filteredStudents = students.filter(
    (s) =>
      s.name.toLowerCase().includes(filters.name.toLowerCase()) &&
      s.class.toLowerCase().includes(filters.class.toLowerCase()) &&
      s.gvcn.toLowerCase().includes(filters.gvcn.toLowerCase())
  );

  // Pagination logic
  const indexOfLastStudent = currentPage * studentsPerPage;
  const indexOfFirstStudent = indexOfLastStudent - studentsPerPage;
  const currentStudents = filteredStudents.slice(indexOfFirstStudent, indexOfLastStudent);
  const totalPages = Math.ceil(filteredStudents.length / studentsPerPage);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const handleReply = async (studentId) => {
    try {
      setSelectedStudent(studentId);
      const sessionsRes = await getSessions(studentId, token);
      const sessions = sessionsRes.data;

      for (const session of sessions) {
        await markRead(session.id, token);
      }

      setStudents((prev) => {
        const updatedStudents = prev.map((s) =>
          s.id === studentId ? { ...s, unread: 'Đã đọc' } : s
        );
        // Re-sort students after marking as read
        return updatedStudents.sort((a, b) => {
          const priority = { 'Chưa đọc': 1, 'Đã đọc': 2, 'Chưa nhắn': 3 };
          return priority[a.unread] - priority[b.unread];
        });
      });

      setView('chat');
      navigate(`/teacher/chat/${studentId}`);
    } catch (err) {
      console.error('Handle reply error:', err);
      if (err.response?.status === 401) {
        window.location.href = '/login';
      } else {
        alert(`Không thể mở phiên chat: ${err.message}`);
      }
    }
  };

  const handleModalConfirm = () => {
    if (modalStudentId) {
      handleReply(modalStudentId);
    }
    setShowModal(false);
    setModalStudentId(null);
    setModalMessage('');
  };

  const handleModalCancel = () => {
    setShowModal(false);
    setModalStudentId(null);
    setModalMessage('');
  };

  if (view === 'chat') {
    return (
      <Chat
        mode="Giáo viên"
        userId={userId}
        studentId={selectedStudent}
        token={token}
        currentSession={currentSession}
        setCurrentSession={setCurrentSession}
        aiEnabled={aiEnabled}
        sidebarCollapsed={sidebarCollapsed}
      />
    );
  }

  return (
    <div className={`teacher-dashboard ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <ConfirmModal
        show={showModal}
        message={modalMessage}
        onConfirm={handleModalConfirm}
        onCancel={handleModalCancel}
      />
      <div className="dashboard-header">
        <h1>📚 Chatbot Cô Hương - Chế độ Giáo viên</h1>
        <div className="header-actions">
          <label className="ai-toggle">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
            />
            <span>Bật AI</span>
          </label>
          <button className="refresh-btn" onClick={fetchStudents}>
            <FiRefreshCcw size={18} /> Làm mới
          </button>
        </div>
      </div>

      <div className="filter-section">
        <FiFilter className="filter-icon" />
        <input
          name="name"
          placeholder="Lọc theo tên"
          value={filters.name}
          onChange={handleFilter}
        />
        <input
          name="class"
          placeholder="Lọc theo lớp"
          value={filters.class}
          onChange={handleFilter}
        />
        <input
          name="gvcn"
          placeholder="Lọc theo GVCN"
          value={filters.gvcn}
          onChange={handleFilter}
        />
      </div>

      <div className="table-container">
        <table className="student-table">
          <thead>
            <tr>
              <th>STT</th>
              <th>Tên</th>
              <th>Lớp</th>
              <th>GVCN</th>
              <th>Tin cuối</th>
              <th>Trạng thái</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {currentStudents.map((s, index) => (
              <tr key={s.id}>
                <td>{indexOfFirstStudent + index + 1}</td>
                <td>{s.name}</td>
                <td>{s.class}</td>
                <td>{s.gvcn}</td>
                <td>{formatDate(s.last_time)}</td>
                <td>
                  <span
                    className={`status ${
                      s.unread === 'Chưa đọc' ? 'unread' : s.unread === 'Chưa nhắn' ? 'no-message' : 'read'
                    }`}
                  >
                    {s.unread}
                  </span>
                </td>
                <td>
                  <button
                    className="reply-btn"
                    onClick={() => handleReply(s.id)}
                    disabled={!s.hasMessages}
                  >
                    <FiMessageCircle size={16} /> Trả lời
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pagination">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="pagination-btn"
          >
            Trước
          </button>
          {Array.from({ length: totalPages }, (_, index) => (
            <button
              key={index + 1}
              onClick={() => handlePageChange(index + 1)}
              className={`pagination-btn ${currentPage === index + 1 ? 'active' : ''}`}
            >
              {index + 1}
            </button>
          ))}
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="pagination-btn"
          >
            Sau
          </button>
        </div>
      </div>
    </div>
  );
};

export default TeacherDashboard;