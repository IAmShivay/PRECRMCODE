import React from 'react';
import { useLocation } from 'react-router-dom';
import ErrorBoundary, { type ErrorBoundaryVariant } from './ErrorBoundary';

interface RouteErrorBoundaryProps {
  children: React.ReactNode;
  variant?: ErrorBoundaryVariant;
}

export default function RouteErrorBoundary({
  children,
  variant = 'page',
}: RouteErrorBoundaryProps) {
  const location = useLocation();
  const routeKey = `${location.pathname}${location.search}${location.hash}`;

  return (
    <ErrorBoundary resetKeys={[routeKey]} variant={variant}>
      {children}
    </ErrorBoundary>
  );
}
