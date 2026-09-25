import { redirect } from 'next/navigation';
import { authMode, getSession } from '@/lib/session';
import { aiEnabled } from '@/lib/ai';
import { storageLabel } from '@/lib/storage';
import Logbook from '@/components/Logbook';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const s = await getSession();
  if (!s) redirect('/login');
  const mode = authMode();
  return <Logbook config={{ uid: s.uid, login: s.login, ai: aiEnabled(), storage: storageLabel(), canSignOut: mode === 'github' || mode === 'password' }} />;
}
