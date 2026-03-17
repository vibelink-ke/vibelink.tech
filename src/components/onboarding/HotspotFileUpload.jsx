import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle, AlertCircle, Download, Upload } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

export default function HotspotFileUpload({ hotspotId, hotspots, mikrotiks, onComplete }) {
  const [selectedHotspot, setSelectedHotspot] = useState(hotspotId || '');
  const [selectedMikrotik, setSelectedMikrotik] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [generatedFile, setGeneratedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);

  const handleGenerateConfig = async () => {
    if (!selectedHotspot || !selectedMikrotik) {
      toast.error('Please select both hotspot and MikroTik router');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await vibelink.functions.invoke('generateHotspotConfig', {
        hotspotId: selectedHotspot,
        mikrotikId: selectedMikrotik
      });

      setGeneratedFile(response.data);
      toast.success('Configuration generated successfully');
    } catch (error) {
      toast.error('Failed to generate configuration: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUploadToMikrotik = async () => {
    if (!generatedFile) {
      toast.error('Please generate configuration first');
      return;
    }

    setIsUploading(true);
    setUploadStatus('uploading');
    try {
      const response = await vibelink.functions.invoke('uploadHotspotToMikrotik', {
        hotspotFileId: generatedFile.hotspotFile.id,
        mikrotikId: selectedMikrotik
      });

      setUploadStatus('success');
      toast.success('Hotspot configuration uploaded to MikroTik');
      
      setTimeout(() => {
        if (onComplete) {
          onComplete(response.data.hotspotFile);
        }
      }, 1500);
    } catch (error) {
      setUploadStatus('error');
      toast.error('Upload failed: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownloadConfig = () => {
    if (!generatedFile) return;

    const element = document.createElement('a');
    const file = new Blob([generatedFile.configPreview], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = generatedFile.hotspotFile.file_name;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Configure Hotspot Files
          </CardTitle>
          <CardDescription>
            Generate and upload hotspot configuration files to MikroTik automatically
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Selection Phase */}
          {!generatedFile && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Hotspot *</Label>
                  <Select value={selectedHotspot} onValueChange={setSelectedHotspot}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select hotspot" />
                    </SelectTrigger>
                    <SelectContent>
                      {hotspots.map(hs => (
                        <SelectItem key={hs.id} value={hs.id}>
                          {hs.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>MikroTik Router *</Label>
                  <Select value={selectedMikrotik} onValueChange={setSelectedMikrotik}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select router" />
                    </SelectTrigger>
                    <SelectContent>
                      {mikrotiks.map(mt => (
                        <SelectItem key={mt.id} value={mt.id}>
                          {mt.name} ({mt.ip_address})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={handleGenerateConfig}
                disabled={!selectedHotspot || !selectedMikrotik || isGenerating}
                className="w-full"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate Configuration'
                )}
              </Button>
            </div>
          )}

          {/* Review Phase */}
          {generatedFile && !uploadStatus && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">Configuration Generated</span>
                </div>
                <p className="text-sm text-emerald-600 mt-1">
                  File: {generatedFile.hotspotFile.file_name}
                </p>
              </div>

              <div className="bg-slate-50 rounded-lg p-4 max-h-48 overflow-y-auto">
                <p className="text-xs font-mono text-slate-600 whitespace-pre-wrap">
                  {generatedFile.configPreview}...
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={handleDownloadConfig}
                  className="flex-1"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
                <Button
                  onClick={handleUploadToMikrotik}
                  disabled={isUploading}
                  className="flex-1"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload to MikroTik
                    </>
                  )}
                </Button>
              </div>

              <Button
                variant="ghost"
                onClick={() => {
                  setGeneratedFile(null);
                  setSelectedHotspot('');
                  setSelectedMikrotik('');
                }}
                className="w-full"
              >
                Back
              </Button>
            </motion.div>
          )}

          {/* Upload Status Phase */}
          {uploadStatus === 'success' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8"
            >
              <div className="flex justify-center mb-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
              <h3 className="font-semibold text-slate-900 mb-2">Upload Complete</h3>
              <p className="text-sm text-slate-500 mb-4">
                Hotspot configuration has been successfully uploaded to MikroTik
              </p>
            </motion.div>
          )}

          {uploadStatus === 'error' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-rose-50 border border-rose-200 rounded-lg p-4"
            >
              <div className="flex items-center gap-2 text-rose-700 mb-2">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">Upload Failed</span>
              </div>
              <p className="text-sm text-rose-600 mb-4">
                There was an error uploading the configuration. Please try again.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setUploadStatus(null);
                  setGeneratedFile(null);
                }}
                className="w-full"
              >
                Start Over
              </Button>
            </motion.div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}