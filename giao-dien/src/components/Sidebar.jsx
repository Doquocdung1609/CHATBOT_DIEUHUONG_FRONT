import { useState, useEffect, useRef } from 'react';
import { getSessions, createSession, deleteSession } from '../services/api';
import { ChevronLeft, ChevronRight, LogOut, MessageSquare, Trash2 } from 'lucide-react';
import '../styles/chat.css';
import { useNavigate, useLocation } from 'react-router-dom';
import ConfirmModal from './ConfirmModal';

const Sidebar = ({
  studentId,
  token,
  currentSession,
  setCurrentSession,
  handleLogout,
  isTeacher = false,
  setCollapsedGlobal,
}) => {
  const [sessions, setSessions] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState(null);
  const hasFetched = useRef(false);
  const hasCreatedInitialSession = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();

  const isTeacherChatPage = location.pathname.startsWith('/teacher/chat');

  useEffect(() => {
    if (token && studentId && !hasFetched.current) {
      hasFetched.current = true;
      fetchSessions();
    }
  }, [studentId, token]);

  const fetchSessions = async () => {
    try {
      const res = await getSessions(studentId, token);
      console.log('Fetched sessions:', res.data);
      setSessions(res.data);

      if (res.data.length > 0) {
        const latestSession = res.data[0].id;
        console.log('Setting currentSession to latest:', latestSession);
        setCurrentSession(latestSession);
      } else if (!hasCreatedInitialSession.current) {
        hasCreatedInitialSession.current = true;
        createNewSession();
      }
    } catch (err) {
      console.error('Fetch sessions error:', err);
      if (err.response?.status === 401) window.location.href = '/login';
    }
  };

  const createNewSession = async () => {
    try {
      const title = `Chat ${new Date().toLocaleString()}`;
      const res = await createSession({ student_id: studentId, title }, token);
      console.log('Created new session:', res.data);
      setSessions((prev) => [
        { id: res.data.id, title, created_at: new Date().toISOString() },
        ...prev,
      ]);
      setCurrentSession(res.data.id);
    } catch (err) {
      console.error('Create session error:', err);
      if (err.response?.status === 401) window.location.href = '/login';
    }
  };

  const deleteSessionHandler = async (sessionId) => {
    setSessionToDelete(sessionId);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!sessionToDelete) return;

    try {
      await deleteSession(sessionToDelete, token);
      console.log('Deleted session:', sessionToDelete);

      // Update session list
      setSessions((prev) => prev.filter((s) => s.id !== sessionToDelete));

      // If the deleted session is currentSession, switch to the latest session or create a new one
      if (sessionToDelete === currentSession) {
        if (sessions.length > 1) {
          const nextSession = sessions.find((s) => s.id !== sessionToDelete);
          setCurrentSession(nextSession ? nextSession.id : null);
        } else {
          hasCreatedInitialSession.current = false;
          setCurrentSession(null);
          createNewSession();
        }
      }
    } catch (err) {
      console.error('Delete session error:', err);
      if (err.response?.status === 401) window.location.href = '/login';
      else alert('Lỗi khi xóa phiên chat: ' + err.message);
    } finally {
      setShowDeleteModal(false);
      setSessionToDelete(null);
    }
  };

  const cancelDelete = () => {
    setShowDeleteModal(false);
    setSessionToDelete(null);
  };

  const toggleSidebar = () => {
    setCollapsed(!collapsed);
    setCollapsedGlobal && setCollapsedGlobal(!collapsed);
  };

  const onLogout = () => {
    handleLogout();
    navigate('/login');
  };

  return (
    <aside className={`sidebar-container ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-title">
          <MessageSquare size={22} />
          {!collapsed && <span>Chatbot Cô Hương</span>}
        </div>
        <button className="toggle-btn" onClick={toggleSidebar}>
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      {!collapsed && (
        <>
          {studentId && (
            <button className="logout-btn" onClick={onLogout}>
              <LogOut size={18} />
              <span>Đăng xuất</span>
            </button>
          )}

          {(!isTeacher || isTeacherChatPage) && (
            <div className="session-section">
              <h4 className="section-title">
                {isTeacher ? 'Phiên chat của học sinh' : 'Lịch sử trò chuyện'}
              </h4>

              {!isTeacher && (
                <button className="create-session-btn" onClick={createNewSession}>
                  <span>Tạo chat mới</span>
                </button>
              )}

              <div className="session-list">
                {sessions.length === 0 ? (
                  <p className="empty-text">Chưa có phiên chat nào</p>
                ) : (
                  sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`session-item ${currentSession === s.id ? 'active' : ''}`}
                    >
                      <span
                        onClick={() => {
                          console.log('Clicked session:', s.id);
                          setCurrentSession(s.id);
                        }}
                      >
                        {s.title}
                      </span>
                      {!isTeacher && (
                        <button
                          className="delete-session-btn"
                          onClick={() => deleteSessionHandler(s.id)}
                          title="Xóa phiên chat"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmModal
        show={showDeleteModal}
        message="Bạn có chắc muốn xóa phiên chat này?"
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </aside>
  );
};

export default Sidebar;