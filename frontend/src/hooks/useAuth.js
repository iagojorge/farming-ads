import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('username');
    
    if (token && user) {
      setIsAuthenticated(true);
      setUsername(user);
    } else {
      setIsAuthenticated(false);
    }
    
    setLoading(false);
  }, []);

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setIsAuthenticated(false);
    setUsername(null);
    navigate('/login');
  };

  const getToken = () => localStorage.getItem('token');

  return { isAuthenticated, username, loading, logout, getToken };
}
