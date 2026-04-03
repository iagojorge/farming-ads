import jwt from 'jsonwebtoken';

const SECRET_KEY = process.env.JWT_SECRET || 'seu-secret-key-super-secreto-2026';
const TOKEN_EXPIRY = '7d'; // Token expira em 7 dias

// Usuários padrão (armazenados em memory, pode ser em arquivo se quiser persistência)
const USERS = {
  admin: '#agenciatitan2026',
};

/**
 * Valida credenciais do usuário
 */
export function validateCredentials(username, password) {
  const correctPassword = USERS[username];
  
  if (!correctPassword) {
    return { valid: false, error: 'Usuário não encontrado' };
  }
  
  if (correctPassword !== password) {
    return { valid: false, error: 'Senha incorreta' };
  }
  
  return { valid: true, username };
}

/**
 * Gera JWT token
 */
export function generateToken(username) {
  return jwt.sign(
    { username, timestamp: new Date().toISOString() },
    SECRET_KEY,
    { expiresIn: TOKEN_EXPIRY }
  );
}

/**
 * Valida JWT token
 */
export function validateToken(token) {
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    return { valid: true, username: decoded.username };
  } catch (err) {
    return { valid: false, error: 'Token inválido ou expirado' };
  }
}

/**
 * Middleware para proteger rotas
 */
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }
  
  const token = authHeader.replace('Bearer ', '');
  const validation = validateToken(token);
  
  if (!validation.valid) {
    return res.status(401).json({ error: validation.error });
  }
  
  req.user = { username: validation.username };
  next();
}
