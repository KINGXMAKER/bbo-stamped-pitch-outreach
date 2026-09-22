import { AppShell } from '@/components/bbo/AppShell';

export default async function ActivationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell initialActivationId={id} />;
}
