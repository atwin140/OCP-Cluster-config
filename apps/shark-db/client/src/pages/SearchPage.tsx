/**
 * SearchPage — search and filter sharks.
 * Supports search by name (common or scientific) + filter by habitat and
 * conservation status.
 */

import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, Fish, ChevronRight, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Navbar } from "@/components/Navbar";
import { StatusBadge } from "@/components/StatusBadge";
import { CONSERVATION_STATUSES } from "@/lib/utils";
import type { Shark } from "@shared/schema";

type SharkWithArrays = Shark & { dietArr: string[]; funFactsArr: string[] };

const HABITATS = [
  "ocean",
  "coastal",
  "reef",
  "deep",
  "arctic",
  "tropical",
  "freshwater",
];

function SharkCard({ shark }: { shark: SharkWithArrays }) {
  return (
    <Link href={`/sharks/${shark.id}`}>
      <a
        className="block shark-card rounded-lg overflow-hidden hover:border-primary/50 transition-all duration-200 glow-cyan group"
        data-testid={`shark-card-${shark.id}`}
      >
        {/* Image */}
        <div className="relative h-36 overflow-hidden bg-muted">
          {shark.imageUrl ? (
            <img
              src={shark.imageUrl}
              alt={shark.commonName}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-4xl">🦈</div>
          )}
          {/* Conservation overlay */}
          <div className="absolute bottom-2 left-2">
            <StatusBadge status={shark.conservationStatus} />
          </div>
        </div>

        {/* Info */}
        <div className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                {shark.commonName}
              </h3>
              <p className="text-xs text-muted-foreground italic">{shark.scientificName}</p>
            </div>
            <ChevronRight size={14} className="text-muted-foreground mt-1 shrink-0 group-hover:text-primary transition-colors" />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 line-clamp-1">{shark.habitat}</p>
          {shark.maxLengthM && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Up to {shark.maxLengthM}m long
            </p>
          )}
        </div>
      </a>
    </Link>
  );
}

function SharkCardSkeleton() {
  return (
    <div className="shark-card rounded-lg overflow-hidden">
      <Skeleton className="h-36 w-full" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export default function SearchPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [habitat, setHabitat] = useState("");
  const [status, setStatus] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [submittedHabitat, setSubmittedHabitat] = useState("");
  const [submittedStatus, setSubmittedStatus] = useState("");

  // Build query key from submitted (not live-typed) values
  const params = new URLSearchParams();
  if (submittedSearch) params.set("search", submittedSearch);
  if (submittedHabitat && submittedHabitat !== "all") params.set("habitat", submittedHabitat);
  if (submittedStatus && submittedStatus !== "all") params.set("status", submittedStatus);
  const queryString = params.toString();

  const { data: sharks, isLoading, error } = useQuery<SharkWithArrays[]>({
    queryKey: [`/api/sharks${queryString ? `?${queryString}` : ""}`],
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSubmittedSearch(searchTerm);
    setSubmittedHabitat(habitat);
    setSubmittedStatus(status);
  }

  function handleClear() {
    setSearchTerm("");
    setHabitat("");
    setStatus("");
    setSubmittedSearch("");
    setSubmittedHabitat("");
    setSubmittedStatus("");
  }

  const hasFilters = submittedSearch || (submittedHabitat && submittedHabitat !== "all") || (submittedStatus && submittedStatus !== "all");

  return (
    <div className="min-h-screen shark-gradient">
      <Navbar />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Fish size={20} className="text-primary" />
            Shark Search
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Search by name, filter by habitat or conservation status
          </p>
        </div>

        {/* Search form */}
        <Card className="shark-card mb-6">
          <CardContent className="pt-5 pb-4">
            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <Input
                  placeholder="Search by common or scientific name…"
                  className="pl-9"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  data-testid="input-search"
                />
              </div>

              <Select value={habitat} onValueChange={setHabitat}>
                <SelectTrigger className="w-full sm:w-44" data-testid="select-habitat">
                  <Filter size={12} className="mr-1" />
                  <SelectValue placeholder="Habitat" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All habitats</SelectItem>
                  {HABITATS.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h.charAt(0).toUpperCase() + h.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full sm:w-52" data-testid="select-status">
                  <SelectValue placeholder="Conservation status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {CONSERVATION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex gap-2">
                <Button type="submit" className="flex-1 sm:flex-none" data-testid="btn-search">
                  Search
                </Button>
                {hasFilters && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleClear}
                    data-testid="btn-clear"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Results */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <SharkCardSkeleton key={i} />
            ))}
          </div>
        )}

        {error && (
          <div className="text-center py-16 text-muted-foreground" data-testid="search-error">
            <Fish size={40} className="mx-auto mb-3 opacity-30" />
            <p>Something went wrong while fetching sharks.</p>
            <p className="text-xs mt-1">{(error as Error).message}</p>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {hasFilters && (
              <p className="text-sm text-muted-foreground mb-4" data-testid="search-result-count">
                Found <span className="text-foreground font-medium">{sharks?.length ?? 0}</span>{" "}
                shark{sharks?.length !== 1 ? "s" : ""}
                {submittedSearch && ` matching "${submittedSearch}"`}
              </p>
            )}

            {sharks && sharks.length > 0 ? (
              <div
                className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
                data-testid="shark-grid"
              >
                {sharks.map((shark) => (
                  <SharkCard key={shark.id} shark={shark} />
                ))}
              </div>
            ) : (
              <div className="text-center py-20 text-muted-foreground" data-testid="no-results">
                <div className="text-5xl mb-4">🦈</div>
                <p className="font-medium">No sharks found</p>
                <p className="text-sm mt-1">
                  {hasFilters
                    ? "Try adjusting your search or filters."
                    : "The ocean seems empty today."}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
