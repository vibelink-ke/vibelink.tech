import { QueryClient, MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';

export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
	mutationCache: new MutationCache({
		onSuccess: (data, variables, context, mutation) => {
			if (mutation.meta?.disableGlobalToast) return;
			const message = mutation.meta?.successMessage || 'Success';
			toast.success(message);
		},
		onError: (error, variables, context, mutation) => {
			if (mutation.meta?.disableGlobalToast) return;
			const message = mutation.meta?.errorMessage || error.message || 'Error occurred';
			toast.error(message);
		},
	}),
});