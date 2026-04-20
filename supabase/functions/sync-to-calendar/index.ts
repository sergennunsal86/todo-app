import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

async function refreshGoogleToken(userId: string, refreshToken: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!res.ok) { console.error('Token refresh failed:', data); return null; }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await supabase.from('user_integrations').upsert({
    user_id: userId,
    google_access_token: data.access_token,
    google_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  return data.access_token;
}

async function getAccessToken(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_integrations')
    .select('google_access_token, google_refresh_token, google_expires_at')
    .eq('user_id', userId)
    .single();

  if (!data?.google_access_token) return null;

  const expiry = data.google_expires_at ? new Date(data.google_expires_at) : null;
  if (!expiry || expiry.getTime() < Date.now() + 60000) {
    if (!data.google_refresh_token) return null;
    return await refreshGoogleToken(userId, data.google_refresh_token);
  }
  return data.google_access_token;
}

serve(async (req) => {
  try {
    const { todo_id, action } = await req.json() as { todo_id: string; action: 'create' | 'update' | 'delete' };

    const { data: todo } = await supabase
      .from('todos')
      .select('id, text, due_at, remind_before_minutes, user_id, google_event_id')
      .eq('id', todo_id)
      .single();

    if (!todo) return new Response(JSON.stringify({ error: 'Todo not found' }), { status: 404 });

    const token = await getAccessToken(todo.user_id);
    if (!token) {
      return new Response(JSON.stringify({ ok: false, reason: 'no_google_token' }), { headers: { 'Content-Type': 'application/json' } });
    }

    const calendarBase = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const authHeader = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    if (action === 'delete') {
      if (!todo.google_event_id) return new Response(JSON.stringify({ ok: true }));
      await fetch(`${calendarBase}/${todo.google_event_id}`, { method: 'DELETE', headers: authHeader });
      await supabase.from('todos').update({ google_event_id: null }).eq('id', todo_id);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (!todo.due_at) {
      return new Response(JSON.stringify({ ok: false, reason: 'no_due_at' }), { headers: { 'Content-Type': 'application/json' } });
    }

    const start = new Date(todo.due_at);
    const end   = new Date(start.getTime() + 60 * 60000);
    const event: Record<string, unknown> = {
      summary: todo.text,
      description: 'Todo uygulamasından eklendi',
      start: { dateTime: start.toISOString(), timeZone: 'Europe/Istanbul' },
      end:   { dateTime: end.toISOString(),   timeZone: 'Europe/Istanbul' },
    };
    if (todo.remind_before_minutes) {
      event.reminders = {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: todo.remind_before_minutes }],
      };
    }

    let res: Response;
    if (action === 'create' || !todo.google_event_id) {
      res = await fetch(calendarBase, { method: 'POST', headers: authHeader, body: JSON.stringify(event) });
    } else {
      res = await fetch(`${calendarBase}/${todo.google_event_id}`, { method: 'PATCH', headers: authHeader, body: JSON.stringify(event) });
    }

    const calData = await res.json();
    if (res.ok && calData.id) {
      await supabase.from('todos').update({ google_event_id: calData.id }).eq('id', todo_id);
    } else {
      console.error('Calendar API error:', calData);
    }

    return new Response(JSON.stringify({ ok: res.ok, event_id: calData.id }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
