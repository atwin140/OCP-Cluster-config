/**
 * AllSharksPage — full directory of sharks in a data-table style layout.
 * Editor/admin users see an "Add Shark" button.
 */

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Plus, Database, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Navbar } from "@/components/Navbar";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import type { Shark } from "@shared/schema";

type SharkWithArrays = Shark & { dietArr: string[]; funFactsArr: string[] };

export default function AllSharksPage() {
  const { isEditor, isAdmin } = useAuth();
  const canEdit = isEditor || isAdmin;

  const { data: sharks, isLoading } = useQuery<SharkWithArrays[]>({
    queryKey: ["/api/sharks"],
  });

  return (
    <div className="min-h-screen shark-gradient">
      <Navbar />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Database size={18} className="text-primary" />
              Shark Directory
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              All species in the database — click any row for full detail
            </p>
          </div>
          {canEdit && (
            <Link href="/sharks/new">
              <a data-testid="btn-add-shark">
                <Button size="sm" className="flex items-center gap-1.5">
                  <Plus size={14} />
                  Add Shark
                </Button>
              </a>
            </Link>
          )}
        </div>

        <Card className="shark-card">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="shark-table">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Species</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">Habitat</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden md:table-cell">Updated By</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden lg:table-cell">Updated At</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {sharks?.map((shark) => (
                      <tr
                        key={shark.id}
                        className="hover:bg-muted/20 transition-colors group"
                        data-testid={`shark-row-${shark.id}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{shark.commonName}</p>
                          <p className="text-xs text-muted-foreground italic">{shark.scientificName}</p>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <p className="text-muted-foreground line-clamp-1 max-w-xs">{shark.habitat}</p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={shark.conservationStatus} />
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-xs text-primary font-medium">{shark.updatedBy}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-xs text-muted-foreground">{formatDate(shark.updatedAt)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/sharks/${shark.id}`}>
                            <a
                              className="text-muted-foreground hover:text-primary transition-colors"
                              data-testid={`link-shark-detail-${shark.id}`}
                            >
                              <ExternalLink size={14} />
                            </a>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
