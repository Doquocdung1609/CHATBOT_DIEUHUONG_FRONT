import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

export const studentRegister = (data) =>
  api.post('/student_register', {
    username: data.username,
    name: data.name,
    class_name: data.className,
    gvcn: data.gvcn,
    password: data.password,
  });

export const loginStudent = (data) =>
  api.post('/student_login', {
    username: data.username,
    password: data.password,
  });

export const teacherLogin = (creds) => api.post('/teacher_login', creds);

export const getStudents = (token) => api.get('/students', { params: { token } });

export const getSessions = (studentId, token) => api.get(`/sessions/${studentId}`, { params: { token } });

export const createSession = (data, token) => api.post('/sessions', {
  session: { ...data },
  token
});

export const getConversations = (sessionId, token) => api.get(`/conversations/${sessionId}`, { params: { token } });

export const addMessage = (message, token) => api.post('/conversations', { message, token });

export const sendToAI = (data, token) => {
  return fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/chatbot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ request: data, token }),
  });
};

export const getTeacher = (teacherId, token) => api.get(`/teacher/${teacherId}`, { params: { token } });

export const markRead = (sessionId, token) =>
  api.post(`/mark_read/${sessionId}`, null, { params: { token } });

export const getUnread = (studentId, token) => api.get(`/unread/${studentId}`, { params: { token } });

export const getLastMessage = (studentId, token) => api.get(`/last_message/${studentId}`, { params: { token } });

export const getStudent = (studentId, token) => api.get(`/student/${studentId}`, { params: { token } });

export const getLatestSession = (studentId, token) => api.get(`/student/${studentId}/latest_session`, { params: { token } });

export const deleteSession = (sessionId, token) => api.delete(`/sessions/${sessionId}`, { params: { token } });
