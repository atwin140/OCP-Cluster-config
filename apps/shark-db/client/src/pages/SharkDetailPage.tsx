/**
 * SharkDetailPage — full detail view for a single shark.
 *
 * Displays:
 *  - Name, taxonomy, image
 *  - Habitat, diet, size, conservation status
 *  - Fun facts
 *  - Audit information (updated_by, updated_at, created_at)
 *  - Comments (public view + authenticated post)
 *  - Edit link (editor/admin only)
 *
 * The audit block is especially useful during GitOps demos — it shows
 * who last changed the record and when, mirroring pipeline change history.
 */

import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, Edit, Clock, User, MapPin, Fish, Star,
  Weight, Ruler, MessageCircle, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Navbar } from "@/components/Navbar";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import type { Shark, Comment } from "@shared/schema";

type SharkWithArrays = Shark & { dietArr: string[]; funFactsArr: string[] };

// --- Comment list & form ---------------------------------------------------

function CommentSection({ sharkId }: { sharkId: number }) {
  const { isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const [body, setBody] = useState("");

  const { data: comments, isLoading } = useQuery<Comment[]>({
    queryKey: [`/api/sharks/${sharkId}/comments`],
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sharks/${sharkId}/comments`, { body });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to post comment");
      }
      return res.json();
    },
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: [`/api/sharks/${sharkId}/comments`] });
      toast({ title: "Comment posted!", description: "Your splash has been recorded." });
    },
    onError: (e: Error) =>
      toast({ title: "Could not post comment", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className="shark-card mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageCircle size={14} className="text-primary" />
          Field Notes &amp; Comments
          {comments && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {comments.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Post comment */}
        {isAuthenticated ? (
          <div className="space-y-2">
            <Textarea
              placeholder="Add your field observation…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="resize-none text-sm bg-muted/40"
              rows={3}
              data-testid="input-comment-body"
            />
            <Button
              size="sm"
              onClick={() => body.trim() && postMutation.mutate()}
              disabled={postMutation.isPending || !body.trim()}
              data-testid="btn-post-comment"
            >
              <Send size={12} className="mr-1.5" />
              {postMutation.isPending ? "Posting…" : "Post Comment"}
            </Button>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
            <Link href="/">
              <a className="text-primary hover:underline">Sign in</a>
            </Link>{" "}
            to add your field observations.
          </div>
        )}

        <Separator />

        {/* Comment list */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        )}

        {comments && comments.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No observations yet. Be the first to dive in!
          </p>
        )}

        {comments && comments.length > 0 && (
          <div className="space-y-4" data-testid="comment-list">
            {comments.map((c) => (
              <div key={c.id} className="space-y-1" data-testid={`comment-${c.id}`}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <User size={10} />
                  <span className="font-medium text-foreground">{c.username}</span>
                  <span>·</span>
                  <Clock size={10} />
                  <span>{formatDate(c.createdAt)}</span>
                </div>
                <p className="text-sm text-foreground pl-3 border-l border-border">{c.body}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main page -------------------------------------------------------------

export default function SharkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isEditor, isAdmin } = useAuth();

  const { data: shark, isLoading, error } = useQuery<SharkWithArrays>({
    queryKey: [`/api/sharks/${id}`],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen shark-gradient">
        <Navbar />
        <div className="mx-auto max-w-4xl px-4 py-8 space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !shark) {
    return (
      <div className="min-h-screen shark-gradient">
        <Navbar />
        <div className="text-center py-24 text-muted-foreground">
          <div className="text-5xl mb-4">🦈</div>
          <p className="font-medium">Shark not found</p>
          <Link href="/search">
            <a className="text-primary text-sm mt-2 hover:underline">Back to search</a>
          </Link>
        </div>
      </div>
    );
  }

  const canEdit = isEditor || isAdmin;

  return (
    <div className="min-h-screen shark-gradient">
      <Navbar />

      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 fade-in">
        {/* Breadcrumb */}
        <div className="flex items-center justify-between mb-6">
          <Link href="/search">
            <a
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-back"
            >
              <ArrowLeft size={14} />
              Back to Search
            </a>
          </Link>
          {canEdit && (
            <Link href={`/sharks/${shark.id}/edit`}>
              <a data-testid="link-edit-shark">
                <Button size="sm" variant="outline" className="border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground">
                  <Edit size={13} className="mr-1.5" />
                  Edit Record
                </Button>
              </a>
            </Link>
          )}
        </div>

        {/* Hero */}
        <Card className="shark-card overflow-hidden mb-6">
          <div className="md:flex">
            {/* Image */}
            <div className="md:w-72 h-56 md:h-auto bg-muted shrink-0">
              {shark.imageUrl ? (
                <img
                  src={shark.imageUrl}
                  alt={shark.commonName}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-6xl">🦈</div>
              )}
            </div>

            {/* Details */}
            <CardContent className="p-5 flex-1">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h1
                    className="text-xl font-bold text-foreground"
                    data-testid="shark-common-name"
                  >
                    {shark.commonName}
                  </h1>
                  <p className="text-sm text-muted-foreground italic" data-testid="shark-scientific-name">
                    {shark.scientificName}
                  </p>
                </div>
                <StatusBadge status={shark.conservationStatus} />
              </div>

              {/* Stat grid */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="flex items-start gap-2">
                  <MapPin size={13} className="text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Habitat</p>
                    <p className="text-sm text-foreground" data-testid="shark-habitat">{shark.habitat}</p>
                  </div>
                </div>

                {shark.maxLengthM && (
                  <div className="flex items-start gap-2">
                    <Ruler size={13} className="text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Max Length</p>
                      <p className="text-sm text-foreground">{shark.maxLengthM} m ({(shark.maxLengthM * 3.28084).toFixed(1)} ft)</p>
                    </div>
                  </div>
                )}

                {shark.maxWeightKg && (
                  <div className="flex items-start gap-2">
                    <Weight size={13} className="text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Max Weight</p>
                      <p className="text-sm text-foreground">{shark.maxWeightKg.toLocaleString()} kg</p>
                    </div>
                  </div>
                )}

                {shark.dietArr && shark.dietArr.length > 0 && (
                  <div className="flex items-start gap-2">
                    <Fish size={13} className="text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Diet</p>
                      <p className="text-sm text-foreground capitalize">
                        {shark.dietArr.join(", ")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </div>
        </Card>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Fun facts */}
          <div className="md:col-span-2">
            <Card className="shark-card h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Star size={14} className="text-accent" />
                  Fun Facts
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {shark.funFactsArr && shark.funFactsArr.length > 0 ? (
                  <ul className="space-y-2" data-testid="fun-facts-list">
                    {shark.funFactsArr.map((fact, i) => (
                      <li key={i} className="flex gap-2.5 text-sm">
                        <span className="text-primary shrink-0 mt-0.5">▸</span>
                        <span className="text-foreground">{fact}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No fun facts recorded yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Audit information */}
          <div>
            <Card className="shark-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock size={14} className="text-primary" />
                  Record Audit
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Created</p>
                  <p className="text-xs text-foreground" data-testid="shark-created-at">
                    {formatDate(shark.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Created by</p>
                  <p className="text-xs text-foreground font-medium" data-testid="shark-created-by">
                    {shark.createdBy}
                  </p>
                </div>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground">Last updated</p>
                  <p className="text-xs text-foreground" data-testid="shark-updated-at">
                    {formatDate(shark.updatedAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Updated by</p>
                  <p
                    className="text-xs font-medium text-primary"
                    data-testid="shark-updated-by"
                  >
                    {shark.updatedBy}
                  </p>
                </div>

                <Separator />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Audit fields record who changed each shark record and when —
                  mirroring GitOps commit authorship and timestamps in your pipeline.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Comments */}
        <CommentSection sharkId={Number(id)} />
      </div>
    </div>
  );
}
