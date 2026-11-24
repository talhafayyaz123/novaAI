import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { GeneratorWorkspace } from '../components/GeneratorWorkspace';
import { useAuth } from '../contexts/AuthContext';

export default function GeneratePage() {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') void router.replace('/login');
  }, [router, status]);

  return <GeneratorWorkspace />;
}
