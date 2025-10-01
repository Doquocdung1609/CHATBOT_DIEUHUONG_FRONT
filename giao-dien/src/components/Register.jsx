// Register.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { studentRegister } from '../services/api';
import '../styles/auth.css';

function Register() {
  const [name, setName] = useState('');
  const [className, setClassName] = useState('');
  const [gvcn, setGvcn] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState(''); // 'error' | 'success'
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setType('');

    if (!name || !className || !gvcn || !username || !password) {
      setType('error');
      setMessage('Vui lòng điền đầy đủ thông tin.');
      return;
    }

    try {
      await studentRegister({ username, name, className, gvcn, password });
      setType('success');
      setMessage('🎉 Đăng ký thành công! Vui lòng đăng nhập.');
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setType('error');
      setMessage('Đăng ký thất bại: ' + (err.response?.data?.detail || 'Vui lòng thử lại sau.'));
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-brand">Chatbot Cô Hương</h1>
        </div>

        <h2 className="auth-title">Đăng ký</h2>

        {/* --- Thông báo --- */}
        {message && <div className={`auth-alert ${type}`}>{message}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <input className="auth-input" placeholder="Tên" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="auth-input" placeholder="Lớp" value={className} onChange={(e) => setClassName(e.target.value)} />
          <input className="auth-input" placeholder="GVCN" value={gvcn} onChange={(e) => setGvcn(e.target.value)} />
          <input className="auth-input" placeholder="Số điện thoại" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="auth-input" type="password" placeholder="Mật khẩu" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" className="auth-button">Đăng ký</button>
          <p className="auth-text">
            Đã có tài khoản? <a href="/login" className="auth-link">Đăng nhập</a>
          </p>
        </form>
      </div>
    </div>
  );
}

export default Register;
