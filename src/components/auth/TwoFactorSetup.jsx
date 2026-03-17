import React, { useState, useEffect } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { QRCodeSVG } from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, Copy, CheckCircle2, Download, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

export default function TwoFactorSetup({ onComplete }) {
    const [step, setStep] = useState(1);
    const [secret, setSecret] = useState('');
    const [otpAuthUrl, setOtpAuthUrl] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [backupCodes, setBackupCodes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        generateSecret();
    }, []);

    const generateSecret = async () => {
        try {
            setLoading(true);
            const { data } = await vibelink.functions.invoke('generate2FASecret', {});
            setSecret(data.secret);
            setOtpAuthUrl(data.otpAuthUrl);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async () => {
        try {
            setLoading(true);
            setError('');
            const { data } = await vibelink.functions.invoke('verify2FASetup', {
                secret,
                token: verificationCode
            });

            if (data.success) {
                setBackupCodes(data.backupCodes);
                setStep(2);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Invalid verification code');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    };

    const downloadBackupCodes = () => {
        const text = `VIBELINK 2FA Backup Codes\n\nSave these codes in a secure location.\nEach code can only be used once.\n\n${backupCodes.join('\n')}`;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vibelink-backup-codes.txt';
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="max-w-2xl mx-auto p-6">
            <AnimatePresence mode="wait">
                {step === 1 && (
                    <motion.div
                        key="step1"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                    >
                        <Card>
                            <CardHeader>
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                                        <Shield className="w-5 h-5 text-indigo-600" />
                                    </div>
                                    <div>
                                        <CardTitle>Enable Two-Factor Authentication</CardTitle>
                                        <CardDescription>Scan the QR code with your authenticator app</CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {error && (
                                    <Alert variant="destructive">
                                        <AlertDescription>{error}</AlertDescription>
                                    </Alert>
                                )}

                                <div className="bg-slate-50 rounded-lg p-6">
                                    <h3 className="font-semibold mb-4">Step 1: Scan QR Code</h3>
                                    <p className="text-sm text-slate-600 mb-4">
                                        Use an authenticator app like Google Authenticator, Authy, or Microsoft Authenticator
                                    </p>
                                    {otpAuthUrl && (
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="bg-white p-4 rounded-lg">
                                                <QRCodeSVG value={otpAuthUrl} size={200} />
                                            </div>
                                            <div className="w-full">
                                                <p className="text-xs text-slate-500 mb-2">Or enter this code manually:</p>
                                                <div className="flex items-center gap-2">
                                                    <code className="flex-1 bg-white px-3 py-2 rounded border text-sm font-mono">
                                                        {secret}
                                                    </code>
                                                    <Button
                                                        variant="outline"
                                                        size="icon"
                                                        onClick={() => copyToClipboard(secret)}
                                                    >
                                                        <Copy className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="bg-slate-50 rounded-lg p-6">
                                    <h3 className="font-semibold mb-4">Step 2: Enter Verification Code</h3>
                                    <p className="text-sm text-slate-600 mb-4">
                                        Enter the 6-digit code from your authenticator app
                                    </p>
                                    <Input
                                        type="text"
                                        placeholder="000000"
                                        value={verificationCode}
                                        onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                        maxLength={6}
                                        className="text-center text-2xl font-mono tracking-widest"
                                    />
                                </div>

                                <Button
                                    onClick={handleVerify}
                                    disabled={verificationCode.length !== 6 || loading}
                                    className="w-full"
                                >
                                    {loading ? 'Verifying...' : 'Verify and Enable 2FA'}
                                </Button>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}

                {step === 2 && (
                    <motion.div
                        key="step2"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                    >
                        <Card>
                            <CardHeader>
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                                    </div>
                                    <div>
                                        <CardTitle>2FA Successfully Enabled</CardTitle>
                                        <CardDescription>Save your backup codes for account recovery</CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <Alert>
                                    <AlertTriangle className="w-4 h-4" />
                                    <AlertDescription>
                                        Save these backup codes in a secure location. Each code can only be used once.
                                    </AlertDescription>
                                </Alert>

                                <div className="bg-slate-50 rounded-lg p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="font-semibold">Backup Codes</h3>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={downloadBackupCodes}
                                        >
                                            <Download className="w-4 h-4 mr-2" />
                                            Download
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        {backupCodes.map((code, idx) => (
                                            <div
                                                key={idx}
                                                className="bg-white px-4 py-3 rounded border font-mono text-sm flex items-center justify-between"
                                            >
                                                <span>{code}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => copyToClipboard(code)}
                                                >
                                                    <Copy className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <Button onClick={onComplete} className="w-full">
                                    Complete Setup
                                </Button>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}