import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { UserCircle } from 'lucide-react';

export default function OnboardingStep2({ data, onNext, onBack }) {
  const [formData, setFormData] = useState(data);
  const [errors, setErrors] = useState({});

  const handleSubmit = () => {
    const newErrors = {};
    if (!formData.admin_name?.trim()) newErrors.admin_name = 'Admin name is required';
    if (!formData.admin_email?.trim()) newErrors.admin_email = 'Admin email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.admin_email)) {
      newErrors.admin_email = 'Invalid email format';
    }
    if (!formData.phone?.trim()) newErrors.phone = 'Phone number is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onNext(formData);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCircle className="w-5 h-5 text-indigo-600" />
            Admin Profile Setup
          </CardTitle>
          <CardDescription>
            Create your admin account for managing the ISP platform
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="admin_name">Full Name *</Label>
            <Input
              id="admin_name"
              value={formData.admin_name || ''}
              onChange={(e) => {
                setFormData({ ...formData, admin_name: e.target.value });
                if (errors.admin_name) setErrors({ ...errors, admin_name: '' });
              }}
              placeholder="John Doe"
              className="mt-2"
            />
            {errors.admin_name && <p className="text-red-500 text-sm mt-1">{errors.admin_name}</p>}
          </div>

          <div>
            <Label htmlFor="admin_email">Email Address *</Label>
            <Input
              id="admin_email"
              type="email"
              value={formData.admin_email || ''}
              onChange={(e) => {
                setFormData({ ...formData, admin_email: e.target.value });
                if (errors.admin_email) setErrors({ ...errors, admin_email: '' });
              }}
              placeholder="admin@company.com"
              className="mt-2"
            />
            {errors.admin_email && <p className="text-red-500 text-sm mt-1">{errors.admin_email}</p>}
          </div>

          <div>
            <Label htmlFor="phone">Phone Number *</Label>
            <Input
              id="phone"
              value={formData.phone || ''}
              onChange={(e) => {
                setFormData({ ...formData, phone: e.target.value });
                if (errors.phone) setErrors({ ...errors, phone: '' });
              }}
              placeholder="+254 712 345 678"
              className="mt-2"
            />
            {errors.phone && <p className="text-red-500 text-sm mt-1">{errors.phone}</p>}
          </div>

          <div className="flex gap-3 pt-4">
            <Button onClick={onBack} variant="outline" className="w-full">
              Back
            </Button>
            <Button onClick={handleSubmit} className="w-full bg-indigo-600 hover:bg-indigo-700">
              Review & Complete
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}