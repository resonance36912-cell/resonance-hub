export function resolveBrandContext(input: {
  approved: Record<string,string>; current?: Record<string,string>;
}) {
  const current=input.current ?? {};
  const effective={...input.approved,...current};
  const conflicts=Object.keys(current).filter(k=>k in input.approved && input.approved[k]!==current[k]);
  return { effective, conflicts };
}
