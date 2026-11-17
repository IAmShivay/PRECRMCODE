import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowPathIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import CustomerDetails from '../components/CustomerDetails';
import type { Customer } from '../components/types';
import { readCustomers } from '../lib/api-client';
import { formatWorkspaceCurrency } from '../lib/currency';

function formatDate(value: string): string {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export default function CustomersPage() {
  const { currentWorkspace, getUserRole } = useAuth();
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const detailsRef = React.useRef<HTMLDivElement>(null);
  const workspaceId = currentWorkspace?.id;
  const currency = currentWorkspace?.currency;

  React.useEffect(() => {
    if (!workspaceId) {
      setCustomers([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setCustomers([]);
    setSelectedId(null);

    void readCustomers(workspaceId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setCustomers(Array.isArray(response.data) ? response.data : []);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Failed to load customers');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  const filteredCustomers = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => [
      customer.name,
      customer.email,
      customer.phone,
      customer.address,
      customer.contact,
      ...(customer.custom_fields || []).flatMap((field) => [field.label, field.value]),
      ...customer.orders.map((order) => order.deal_name),
      ...customer.orders.flatMap((order) => (order.items || []).map((item) => item.name)),
    ].some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [customers, query]);

  const orderCount = customers.reduce((sum, customer) => sum + customer.order_count, 0);
  const convertedValue = customers.reduce((sum, customer) => sum + customer.total_value, 0);
  const selectedCustomer = customers.find((customer) => customer.id === selectedId);

  React.useEffect(() => {
    if (!selectedId) return;
    const frame = window.requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId]);

  if (!currentWorkspace) {
    return <div className="text-sm text-gray-600">Select a workspace to view customers.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Customers</h1>
          <p className="mt-1 text-sm text-gray-500">Deals in a conversion stage become customers. Add contact details, custom fields, and ordered items while leads stay in Leads.</p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Customers', value: String(customers.length) },
          { label: 'Converted deals', value: String(orderCount) },
          { label: 'Converted value', value: formatWorkspaceCurrency(convertedValue, currency) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
            <div className="text-xs font-medium text-gray-500">{stat.label}</div>
            <div className="mt-1 text-xl font-semibold text-gray-900">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="text-sm font-semibold text-gray-900">Customer list</div>
          <div className="relative w-full sm:w-72">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search customers or deals"
              aria-label="Search customers or deals"
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-gray-400"
            />
          </div>
        </div>

        {error ? (
          <div role="alert" className="px-5 py-8 text-sm text-red-600">{error}</div>
        ) : loading ? (
          <div className="px-5 py-12 text-center text-sm text-gray-500">Loading customers…</div>
        ) : filteredCustomers.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <UserGroupIcon className="mx-auto h-9 w-9 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-800">{query ? 'No customers match your search' : 'No customers yet'}</p>
            <p className="mt-1 text-sm text-gray-500">{query ? 'Try a different name or deal.' : 'Move a deal to a conversion stage to see its customer here.'}</p>
            {!query && <Link to="/deals" className="mt-4 inline-block text-sm font-medium text-gray-900 underline">Go to Deals</Link>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-5 py-3">Customer</th>
                  <th scope="col" className="px-5 py-3">Contact</th>
                  <th scope="col" className="px-5 py-3 text-right">Converted deals</th>
                  <th scope="col" className="px-5 py-3 text-right">Converted value</th>
                  <th scope="col" className="px-5 py-3">Latest conversion</th>
                  <th scope="col" className="px-5 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-gray-50/70">
                    <td className="px-5 py-4 font-medium text-gray-900">
                      <div>{customer.name}</div>
                      {customer.lead_id ? (
                        <Link to={`/leads/${customer.lead_id}`} className="mt-0.5 inline-block text-xs font-normal text-gray-500 hover:text-gray-900 hover:underline">View lead</Link>
                      ) : (
                        <span className="mt-0.5 inline-block text-xs font-normal text-gray-400">Deal contact</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      <div>{customer.email || customer.contact || '—'}</div>
                      {customer.phone && <div className="text-xs text-gray-500">{customer.phone}</div>}
                    </td>
                    <td className="px-5 py-4 text-right text-gray-700">{customer.order_count}</td>
                    <td className="px-5 py-4 text-right font-medium text-gray-900">{formatWorkspaceCurrency(customer.total_value, currency)}</td>
                    <td className="px-5 py-4 text-gray-600">{formatDate(customer.last_won_at)}</td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedId(selectedId === customer.id ? null : customer.id)}
                        aria-expanded={selectedId === customer.id}
                        aria-label={`${selectedId === customer.id ? 'Hide' : 'Show'} details for ${customer.name}`}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      >
                        {selectedId === customer.id ? 'Hide' : 'View'}
                        <ChevronDownIcon className={`h-4 w-4 transition-transform ${selectedId === customer.id ? 'rotate-180' : ''}`} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedCustomer && (
        <div ref={detailsRef}>
          <CustomerDetails
            canEdit={Boolean(workspaceId && getUserRole(workspaceId) === 'admin')}
            customer={selectedCustomer}
            currency={currency}
            onSaved={(saved) => setCustomers((current) => current.map((item) => item.id === saved.id ? saved : item))}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  );
}
