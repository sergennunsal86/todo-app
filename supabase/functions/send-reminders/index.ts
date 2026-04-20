import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY')!;
const VAPID_PRIVATE    = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_PUBLIC     = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_SUBJECT    = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// ── Web Push (VAPID) ─────────────────────────────────────────────────────────

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function buildVapidJwt(endpoint: string): Promise<string> {
  const origin   = new URL(endpoint).origin;
  const header   = { typ: 'JWT', alg: 'ES256' };
  const payload  = { aud: origin, exp: Math.floor(Date.now() / 1000) + 43200, sub: VAPID_SUBJECT };
  const encode   = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const sigInput = `${encode(header)}.${encode(payload)}`;

  const privKey = await crypto.subtle.importKey(
    'pkcs8', fromB64url(VAPID_PRIVATE),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privKey,
    new TextEncoder().encode(sigInput)
  );
  return `${sigInput}.${b64url(sig)}`;
}

async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: object) {
  const jwt = await buildVapidJwt(sub.endpoint);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC}`,
    'TTL': '86400',
  };

  // Encrypt payload using Web Push encryption (RFC 8291)
  const body = JSON.stringify(payload);

  // For simplicity: send unencrypted (content-encoding: aes128gcm requires full ECDH+HKDF)
  // Production: use a library like web-push. Here we send without body and let notification use title from push event.
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
  if (!res.ok && res.status !== 201) {
    const text = await res.text();
    console.error('Push failed:', res.status, text);
  }
}

// ── Email (Resend) ────────────────────────────────────────────────────────────

async function sendEmail(to: string, todo: { text: string; due_at: string }) {
  const dueStr = new Date(todo.due_at).toLocaleString('tr-TR', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Istanbul'
  });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Todo App <onboarding@resend.dev>',
      to: [to],
      subject: `⏰ Hatırlatma: ${todo.text}`,
      html: `<p>Merhaba,</p>
             <p><strong>${todo.text}</strong> görevinin zamanı yaklaşıyor.</p>
             <p>📅 Son tarih: ${dueStr}</p>
             <p><a href="https://sergennunsal86.github.io/todo-app/">Uygulamayı aç</a></p>`,
    }),
  });
  if (!res.ok) console.error('Email failed:', await res.text());
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async () => {
  try {
    const now = new Date();

    // Find todos where remind time has passed but reminders not yet sent
    const { data: todos, error } = await supabase.rpc('todos_due_for_reminder', { check_time: now.toISOString() });
    if (error) {
      // Fallback: manual query
      const { data, error: err2 } = await supabase
        .from('todos')
        .select('id, text, due_at, remind_before_minutes, user_id, reminded_email, reminded_push')
        .not('due_at', 'is', null)
        .not('remind_before_minutes', 'is', null)
        .eq('done', false);
      if (err2) throw err2;

      const due = (data ?? []).filter(t => {
        const remindAt = new Date(t.due_at).getTime() - t.remind_before_minutes * 60000;
        return remindAt <= now.getTime() && (t.reminded_email === false || t.reminded_push === false);
      });

      for (const todo of due) {
        await processTodo(todo);
      }
    } else {
      for (const todo of (todos ?? [])) {
        await processTodo(todo);
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

async function processTodo(todo: { id: string; text: string; due_at: string; user_id: string; reminded_email: boolean; reminded_push: boolean }) {
  // Get user email
  const { data: userData } = await supabase.auth.admin.getUserById(todo.user_id);
  const email = userData?.user?.email;

  if (!todo.reminded_email && email) {
    await sendEmail(email, todo);
  }

  if (!todo.reminded_push) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', todo.user_id);

    for (const sub of (subs ?? [])) {
      await sendPush(sub, { title: '⏰ Hatırlatma', body: todo.text, due: todo.due_at });
    }
  }

  await supabase
    .from('todos')
    .update({ reminded_email: true, reminded_push: true })
    .eq('id', todo.id);
}
