import { useMutation } from '@tanstack/react-query';
import { changePassword } from '@/lib/identityAuthClient';

export function useChangePassword() {
  return useMutation({ mutationFn: changePassword });
}
