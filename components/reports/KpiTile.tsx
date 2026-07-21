import styles from './KpiTile.module.css';

export function KpiTile({
  value,
  label,
  variant = 'neutral',
}: {
  value: number;
  label: string;
  variant?: 'neutral' | 'danger';
}) {
  const isDanger = variant === 'danger';
  return (
    <div className={`${styles.tile} ${isDanger ? styles.tileDanger : styles.tileNeutral}`}>
      <div className={`${styles.value} ${isDanger ? styles.valueDanger : styles.valueNeutral}`}>
        {value}
      </div>
      <div className={`${styles.label} ${isDanger ? styles.labelDanger : styles.labelNeutral}`}>
        {label}
      </div>
    </div>
  );
}
