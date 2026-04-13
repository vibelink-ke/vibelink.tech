import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Building2, Globe } from 'lucide-react';

export default function OnboardingStep1({ data, onNext }) {
  const [formData, setFormData] = useState(data);
  const [errors, setErrors] = useState({});

  const validateSubdomain = (value) => {
    return /^[a-z0-9-]+$/.test(value) && value.length >= 3 && value.length <= 32;
  };

  const handleSubmit = () => {
    const newErrors = {};
    if (!formData.company_name?.trim()) newErrors.company_name = 'Company name is required';
    if (!formData.subdomain?.trim()) newErrors.subdomain = 'Subdomain is required';
    if (!validateSubdomain(formData.subdomain)) newErrors.subdomain = 'Subdomain must be 3-32 characters, lowercase letters, numbers, and hyphens only';

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
            <Building2 className="w-5 h-5 text-indigo-600" />
            Company Information
          </CardTitle>
          <CardDescription>
            Set up your company's basic information and online presence
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="company_name">Company Name *</Label>
            <Input
              id="company_name"
              value={formData.company_name || ''}
              onChange={(e) => {
                setFormData({ ...formData, company_name: e.target.value });
                if (errors.company_name) setErrors({ ...errors, company_name: '' });
              }}
              placeholder="e.g., FastNet ISP"
              className="mt-2"
            />
            {errors.company_name && <p className="text-red-500 text-sm mt-1">{errors.company_name}</p>}
          </div>

          <div>
            <Label htmlFor="subdomain" className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Subdomain *
            </Label>
            <div className="flex items-center mt-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-input px-3">
              <span className="text-slate-500 text-sm">https://</span>
              <Input
                id="subdomain"
                value={formData.subdomain || ''}
                onChange={(e) => {
                  const value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                  setFormData({ ...formData, subdomain: value });
                  if (errors.subdomain) setErrors({ ...errors, subdomain: '' });
                }}
                placeholder="your-company"
                className="border-0 bg-transparent focus-visible:ring-0"
              />
              <span className="text-slate-500 text-sm">.vibelink.com</span>
            </div>
            {errors.subdomain && <p className="text-red-500 text-sm mt-1">{errors.subdomain}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city || ''}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Nairobi"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={formData.country || ''}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                placeholder="Kenya"
                className="mt-2"
              />
            </div>
          </div>

          <Button onClick={handleSubmit} className="w-full bg-indigo-600 hover:bg-indigo-700">
            Continue to Admin Setup
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}