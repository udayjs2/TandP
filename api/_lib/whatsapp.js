// WhatsApp Cloud API helpers (Meta). Env: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.
export const toWhatsAppText = (md) => String(md || "").replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^#+\s*/gm, "").replace(/^- /gm, "• ").slice(0, 3900);

export async function sendWhatsApp(to, text) {
  const token = process.env.WHATSAPP_TOKEN, id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !id) return false;
  const r = await fetch(`https://graph.facebook.com/v20.0/${id}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: toWhatsAppText(text), preview_url: false } }),
  });
  if (!r.ok) throw new Error(`WhatsApp send failed: ${r.status} ${await r.text().catch(() => "")}`);
  return true;
}

// people who get scheduled reports on WhatsApp. Financial reports only go to admins.
export async function reportRecipients(sb, financial) {
  if (!process.env.WHATSAPP_TOKEN) return [];
  let q = sb.from("ai_whatsapp_users").select("phone, role").eq("active", true).eq("receive_reports", true);
  if (financial) q = q.eq("role", "admin");
  const { data } = await q;
  return data || [];
}
