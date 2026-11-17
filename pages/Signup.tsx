import React from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import SignupForm from '../components/auth/SignupForm';

const Signup: React.FC = () => {
  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start managing your customer relationships today"
    >
      <SignupForm />
    </AuthLayout>
  );
};

export default Signup;
