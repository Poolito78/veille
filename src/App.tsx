import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ConcurrentsProvider } from '@/lib/ConcurrentsContext';
import { Layout } from '@/components/Layout';
import Auth from '@/pages/Auth';
import Fiches from '@/pages/Fiches';
import Produits from '@/pages/Produits';
import Notes from '@/pages/Notes';
import Pivot from '@/pages/Pivot';
import Admin from '@/pages/Admin';
import Transport from '@/pages/Transport';

function ProtectedRoutes() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <ConcurrentsProvider>
      <Layout>
        <Routes>
          <Route path="/fiches" element={<Fiches />} />
          <Route path="/produits" element={<Produits />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/pivot" element={<Pivot />} />
          <Route path="/transport" element={<Transport />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/fiches" replace />} />
        </Routes>
      </Layout>
    </ConcurrentsProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </BrowserRouter>
  );
}
