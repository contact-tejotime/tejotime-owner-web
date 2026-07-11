"use client";

import dynamic from "next/dynamic";
import { ChartBodySkeleton } from "@/components/ui/skeletons/CardSkeletons";

/**
 * Lazy chart wrappers. recharts is a heavy client bundle; loading it via next/dynamic
 * (ssr:false — only permitted from a client module, hence this file) trims initial JS
 * and streams each chart behind a skeleton that occupies the chart-body height. The
 * server pages import these instead of the raw charts; the `.chart-card` shell + <h2>
 * stay server-rendered, so only the chart body is deferred. Output is unchanged.
 */
const fallback = () => <ChartBodySkeleton />;

export const CountBarChart = dynamic(() => import("./CountBarChart"), { ssr: false, loading: fallback });
export const RevenueTrendChart = dynamic(() => import("./RevenueTrendChart"), { ssr: false, loading: fallback });
export const VisitsBarChart = dynamic(() => import("./VisitsBarChart"), { ssr: false, loading: fallback });
export const SourcePie = dynamic(() => import("./SourcePie"), { ssr: false, loading: fallback });
