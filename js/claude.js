import { getKv } from './db.js';

const MODEL = 'claude-opus-5-5';

export async function askClaude(system, content, { effort = 'medium', schema } = {}) {
  const apiKey = await getKv('apiKey');
  if (!apiKey) throw new Error('כדי להשתמש ב-Claude צריך להזין מפתח API במסך ההגדרות.');

  const outputConfig = { effort };
  if (schema) outputConfig.format = { type: 'json_schema', schema };

  let response;
  try {
    // Plain fetch: the app has no build step, and this keeps it working as static files.
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        output_config: outputConfig,
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content }],
      }),
    });
  } catch {
    throw new Error('אין חיבור לאינטרנט. מה שנכתב נשמר, ואפשר לנסות שוב אחר כך.');
  }

  if (!response.ok) {
    if (response.status === 401) throw new Error('מפתח ה-API לא תקין. אפשר לבדוק אותו במסך ההגדרות.');
    if (response.status === 402 || response.status === 403) throw new Error('החשבון לא מאפשר את הבקשה. כדאי לבדוק את היתרה וההרשאות ב-Claude Console.');
    if (response.status === 429) throw new Error('יותר מדי בקשות כרגע, או שהגעת לתקרת ההוצאה. אפשר לנסות שוב בעוד כמה דקות.');
    if (response.status >= 500) throw new Error('השירות לא זמין כרגע. אפשר לנסות שוב בעוד כמה דקות.');
    throw new Error(`הבקשה נכשלה (שגיאה ${response.status}).`);
  }

  const message = await response.json();
  if (message.stop_reason === 'refusal') throw new Error('לא התקבלה תשובה על הטקסט הזה. אם קשה עכשיו, ער"ן זמינים בכל שעה בטלפון 1201.');
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new Error('התקבלה תשובה ריקה. אפשר לנסות שוב.');
  return text;
}
