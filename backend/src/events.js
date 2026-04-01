/** Conjunto de clientes SSE conectados. */
const clients = new Set();

export function addClient(res) {
  clients.add(res);
}

export function removeClient(res) {
  clients.delete(res);
}

/**
 * Retorna o número de clientes conectados
 */
export function getConnectedClients() {
  return clients.size;
}

/**
 * Envia um evento SSE para todos os clientes conectados.
 * @param {string} event - Nome do evento (ex: 'status', 'log')
 * @param {object} data  - Payload serializado como JSON
 */
export function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}
