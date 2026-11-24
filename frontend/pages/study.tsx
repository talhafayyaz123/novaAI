import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { StudyWorkspace } from '../components/StudyWorkspace';
import { useAuth } from '../contexts/AuthContext';

export default function StudyPage() {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') void router.replace('/login');
  }, [router, status]);

  return <StudyWorkspace />;
}
