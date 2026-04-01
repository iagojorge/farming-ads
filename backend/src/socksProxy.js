/**
 * Tunnel HTTP → SOCKS5 com autenticação
 * Cria um proxy HTTP local que encaminha conexões SOCKS5 autenticadas.
 * Permite Playwright usar SOCKS5 com user:pass via HTTP proxy local.
 */

import http from 'http';
import net from 'net';
import { SocksClient } from 'socks';

const activeProxies = new Map(); // puerto → { server, socksConfig }

/**
 * Cria um servidor proxy HTTP local que encaminha para SOCKS5 com autenticação.
 * @param {string} socksHost - Host do SOCKS5 (ex: 1.2.3.4)
 * @param {number} socksPort - Porta do SOCKS5 (ex: 1080)
 * @param {string} username - User para SOCKS5
 * @param {string} password - Pass para SOCKS5
 * @returns {Promise<{port: number, close: () => Promise}>}
 */
export async function createSocksProxyTunnel(socksHost, socksPort, username, password) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();

    server.on('connect', async (req, clientSocket, head) => {
      const [destHost, destPort] = req.url.split(':');

      try {
        // Conecta via SOCKS5 ao destino
        const socket = await SocksClient.createConnection({
          proxy: {
            type: 5,
            ipaddress: socksHost,
            port: socksPort,
            userId: username,
            password: password,
          },
          command: 'connect',
          destination: {
            host: destHost,
            port: parseInt(destPort),
          },
        });

        // Escreve resposta CONNECT bem-sucedida
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

        // Cria tunnel bidirecional
        socket.socket.pipe(clientSocket);
        clientSocket.pipe(socket.socket);

        socket.socket.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => socket.socket.destroy());
      } catch (err) {
        console.error(`[socksProxy] Erro SOCKS5 para ${destHost}:${destPort}:`, err.message);
        clientSocket.write('HTTP/1.1 500 Connection Failed\r\n\r\n');
        clientSocket.destroy();
      }
    });

    server.on('error', reject);

    server.listen(0, 'localhost', () => {
      const port = server.address().port;
      activeProxies.set(port, { server, config: { socksHost, socksPort, username, password } });

      console.log(`[socksProxy] ✓ Tunnel criado: localhost:${port} → SOCKS5://${socksHost}:${socksPort}`);

      resolve({
        port,
        url: `http://localhost:${port}`,
        close: () =>
          new Promise((res) => {
            activeProxies.delete(port);
            server.close(res);
          }),
      });
    });
  });
}

/**
 * Fecha todos os tunnels abertos
 */
export async function closeAllProxies() {
  const promises = [];
  for (const [port, { server }] of activeProxies) {
    promises.push(
      new Promise((res) => {
        server.close(res);
        activeProxies.delete(port);
      })
    );
  }
  await Promise.all(promises);
  console.log('[socksProxy] ✓ Todos os tunnels foram fechados');
}

export function getActiveProxyCount() {
  return activeProxies.size;
}
