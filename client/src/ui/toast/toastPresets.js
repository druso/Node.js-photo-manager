export const variantPresets = {
  notification: {
    ariaRole: 'status',
    ariaLive: 'polite',
    containerClass: 'bg-black/85 text-white border-blue-400',
    borderClass: 'border-2',
  },
  info: {
    ariaRole: 'status',
    ariaLive: 'polite',
    containerClass: 'bg-slate-900/90 text-white border-sky-400',
    borderClass: 'border-2',
  },
  success: {
    ariaRole: 'status',
    ariaLive: 'polite',
    containerClass: 'bg-emerald-900/90 text-emerald-50 border-emerald-400',
    borderClass: 'border-2',
  },
  warning: {
    ariaRole: 'alert',
    ariaLive: 'assertive',
    containerClass: 'bg-amber-900/90 text-amber-50 border-amber-400',
    borderClass: 'border-2',
  },
  error: {
    ariaRole: 'alert',
    ariaLive: 'assertive',
    containerClass: 'bg-red-900/90 text-red-50 border-red-400',
    borderClass: 'border-2',
  },
};

export function getPositionClasses(position) {
  switch (position) {
    case 'top-right':
      return 'top-6 right-6';
    case 'top-center':
      return 'top-6 left-1/2 -translate-x-1/2';
    case 'bottom-center':
      return 'bottom-6 left-1/2 -translate-x-1/2';
    case 'bottom-left':
      return 'bottom-6 left-6';
    case 'bottom-right':
    default:
      return 'bottom-6 right-6';
  }
}
