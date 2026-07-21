import styles from './UserAvatar.module.css';

/**
 * Circular initials badge. `initials` is a placeholder prop for now — Phase 4
 * wires this to the real signed-in staff member via useSession().
 */
export function UserAvatar({ initials }: { initials: string }) {
  return (
    <div className={styles.avatar} aria-hidden="true">
      {initials}
    </div>
  );
}
