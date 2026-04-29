import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-6">
      <SignIn />
    </main>
  );
}
