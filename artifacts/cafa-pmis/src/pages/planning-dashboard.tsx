/**
 * Planning Dashboard — deprecated route.
 *
 * The Planning Dashboard has been merged into the Plans workspace.
 * This file is kept only to provide a safe redirect from any existing
 * bookmarks or deep links targeting the old route.
 *
 * The canonical Planning entry point is now: /plans
 */
import { Redirect } from "wouter";

export default function PlanningDashboardPage() {
  return <Redirect to="/plans" />;
}
