import { redirect } from 'next/navigation';
import { authMode, getSession } from '@/lib/session';
import { aiEnabled } from '@/lib/ai';
import { storageLabel } from '@/lib/storage';
import Logbook from '@/components/Logbook';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const mode = authMode();
  const sw = process.env.NODE_ENV === 'production';
  // No sign-in configured: the app runs entirely in the browser, with the preparation file on your computer.
  if (mode === 'none') return <Logbook config={{ uid: 'local', login: '', ai: false, storage: 'this computer', canSignOut: false, server: false, sw }} />;
  const s = await getSession();
  if (!s) redirect('/login');
  return <Logbook config={{ uid: s.uid, login: s.login, ai: aiEnabled(), storage: storageLabel(), canSignOut: mode === 'github' || mode === 'password', server: true, sw }} />;
}
