export const fmtMoney = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export const todayStr = () => new Date().toISOString().slice(0, 10);

export const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const daysInMonth = (mk) => {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

export const itemsTotal = (items = []) =>
  items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0);
