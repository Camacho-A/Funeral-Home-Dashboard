import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable } from './DataTable';

type Row = { name: string; count: number };

describe('DataTable', () => {
  it('renders a header row and one row per item', () => {
    const rows: Row[] = [
      { name: 'Dana', count: 3 },
      { name: 'Chris', count: 5 },
    ];
    render(
      <DataTable<Row>
        rows={rows}
        columns={[
          { header: 'Name', value: (r) => r.name },
          { header: 'Count', value: (r) => String(r.count) },
        ]}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByText('Dana')).toBeInTheDocument();
    expect(screen.getByText('Chris')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // 1 header + 2 data rows
  });

  it('renders an EmptyState instead of an empty table when there are no rows', () => {
    render(<DataTable<Row> rows={[]} columns={[{ header: 'Name', value: (r) => r.name }]} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('No data for this range.')).toBeInTheDocument();
  });

  it('uses a custom empty message when given', () => {
    render(<DataTable<Row> rows={[]} columns={[{ header: 'Name', value: (r) => r.name }]} emptyMessage="Nothing here yet." />);
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
  });
});
