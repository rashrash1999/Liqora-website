const FINAL_STATUSES = new Set(['completed', 'cancelled', 'refunded']);

export function isPastOrder(order, today = new Date()) {
  if (FINAL_STATUSES.has(order?.status)) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order?.eventDate || '')) return false;
  const currentDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(today);
  return order.eventDate < currentDate;
}

export function splitOrders(orders, today = new Date()) {
  return orders.reduce(
    (groups, order) => {
      groups[isPastOrder(order, today) ? 'past' : 'current'].push(order);
      return groups;
    },
    { current: [], past: [] },
  );
}
