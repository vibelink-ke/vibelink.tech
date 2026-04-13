import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Upload, Eye, Save } from 'lucide-react';

export default function HotspotDesign() {
  const [design, setDesign] = useState({
    logo: '',
    title: 'Welcome to Our WiFi',
    subtitle: 'Connect to high-speed internet',
    primaryColor: '#6366f1',
    secondaryColor: '#8b5cf6',
    backgroundColor: '#f8fafc',
    terms: 'By connecting, you agree to our terms of service.',
  });

  const [preview, setPreview] = useState(false);

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setDesign({ ...design, logo: reader.result });
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Hotspot Login Design</h3>
          <p className="text-sm text-slate-500">Customize your WiFi login page</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPreview(!preview)}>
            <Eye className="w-4 h-4 mr-2" />
            {preview ? 'Hide Preview' : 'Show Preview'}
          </Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700">
            <Save className="w-4 h-4 mr-2" />
            Save Design
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Editor */}
        <Card>
          <CardHeader>
            <CardTitle>Design Editor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Logo</Label>
              <div className="flex items-center gap-4">
                {design.logo && (
                  <img src={design.logo} alt="Logo" className="w-16 h-16 object-contain rounded-lg border" />
                )}
                <label className="cursor-pointer">
                  <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                    <Upload className="w-4 h-4" />
                    Upload Logo
                  </div>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Page Title</Label>
              <Input
                value={design.title}
                onChange={(e) => setDesign({ ...design, title: e.target.value })}
                placeholder="Welcome message"
              />
            </div>

            <div className="space-y-2">
              <Label>Subtitle</Label>
              <Input
                value={design.subtitle}
                onChange={(e) => setDesign({ ...design, subtitle: e.target.value })}
                placeholder="Brief description"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Primary Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={design.primaryColor}
                    onChange={(e) => setDesign({ ...design, primaryColor: e.target.value })}
                    className="w-16 h-10 p-1"
                  />
                  <Input
                    value={design.primaryColor}
                    onChange={(e) => setDesign({ ...design, primaryColor: e.target.value })}
                    className="flex-1 font-mono text-sm"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Secondary Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={design.secondaryColor}
                    onChange={(e) => setDesign({ ...design, secondaryColor: e.target.value })}
                    className="w-16 h-10 p-1"
                  />
                  <Input
                    value={design.secondaryColor}
                    onChange={(e) => setDesign({ ...design, secondaryColor: e.target.value })}
                    className="flex-1 font-mono text-sm"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Background</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={design.backgroundColor}
                    onChange={(e) => setDesign({ ...design, backgroundColor: e.target.value })}
                    className="w-16 h-10 p-1"
                  />
                  <Input
                    value={design.backgroundColor}
                    onChange={(e) => setDesign({ ...design, backgroundColor: e.target.value })}
                    className="flex-1 font-mono text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Terms & Conditions</Label>
              <Textarea
                value={design.terms}
                onChange={(e) => setDesign({ ...design, terms: e.target.value })}
                rows={3}
                placeholder="Terms of service..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        {preview && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="lg:sticky lg:top-4"
          >
            <Card>
              <CardHeader>
                <CardTitle>Live Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="rounded-xl p-8 min-h-[500px] flex flex-col items-center justify-center"
                  style={{ backgroundColor: design.backgroundColor }}
                >
                  {design.logo && (
                    <img src={design.logo} alt="Logo" className="w-24 h-24 object-contain mb-6" />
                  )}
                  <h1
                    className="text-3xl font-bold mb-2 text-center"
                    style={{ color: design.primaryColor }}
                  >
                    {design.title}
                  </h1>
                  <p className="text-slate-600 dark:text-slate-400 mb-8 text-center">{design.subtitle}</p>
                  
                  <div className="w-full max-w-sm space-y-4">
                    <Input
                      placeholder="Enter Voucher Code"
                      className="text-center font-mono text-lg tracking-widest"
                      style={{ borderColor: design.primaryColor }}
                    />
                    <Button
                      className="w-full"
                      style={{
                        backgroundColor: design.primaryColor,
                        background: `linear-gradient(135deg, ${design.primaryColor} 0%, ${design.secondaryColor} 100%)`
                      }}
                    >
                      Connect to WiFi
                    </Button>
                  </div>

                  <p className="text-xs text-slate-500 mt-8 text-center max-w-sm">
                    {design.terms}
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  );
}