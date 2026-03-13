import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUser } from "@/contexts/UserContext";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

function OnboardingRoute() {
  const user = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    // Non-admin users should not see the wizard
    if (user && !user.isAdmin) {
      void navigate({ to: "/" });
    }
    // If onboarding is already complete, redirect to home
    if (user?.onboardingComplete) {
      void navigate({ to: "/" });
    }
  }, [user, navigate]);

  if (!user?.isAdmin || user.onboardingComplete) return null;
  return <OnboardingWizard />;
}

export const Route = createFileRoute("/onboarding")({
  component: OnboardingRoute,
});
