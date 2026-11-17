interface ConversationAccessStateProps {
  service: 'WhatsApp' | 'Instagram';
  error: string;
  errorStatus: number | null;
  onRetry: () => void;
}

export default function ConversationAccessState({ service, error, errorStatus, onRetry }: ConversationAccessStateProps) {
  if (!error) return <p role="status" className="p-6 text-gray-500">Loading conversation access…</p>;

  const unavailable = errorStatus === 503;
  return (
    <div role="alert" className="m-4 sm:m-6 max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      <h1 className="text-lg font-semibold">{unavailable ? 'Workspace data is temporarily unavailable' : `${service} could not load`}</h1>
      <p className="mt-2">
        {unavailable
          ? 'The CRM cannot verify your workspace access while its database is unavailable. It will retry automatically.'
          : error}
      </p>
      <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-800">
        Try again now
      </button>
    </div>
  );
}
