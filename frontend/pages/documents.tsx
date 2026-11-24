import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { DocumentWorkspace } from '../components/DocumentWorkspace';
import { useAuth } from '../contexts/AuthContext';

export default function DocumentsPage() {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') void router.replace('/login');
  }, [router, status]);

  return <DocumentWorkspace />;
}
