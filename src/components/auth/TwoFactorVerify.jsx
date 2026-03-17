import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, Key } from 'lucide-react';
import { motion } from 'framer-motion';

export default function TwoFactorVerify({ onSuccess }) {
    const [code, setCode] = useState('');
    const [useBackupCode, setUseBackupCode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleVerify = async () => {
        try {
            setLoading(true);
            setError('');
            const { data } = await vibelink.functions.invoke('verify2FACode', { code });

            if (data.success) {
                if (data.isBackupCode && data.remainingBackupCodes === 0) {
                    alert('Warning: You have used all your backup codes. Please generate new ones in your security settings.');
                } else if (data.isBackupCode && data.remainingBackupCodes <= 3) {
                    alert(`Warning: You have ${data.remainingBackupCodes} backup codes remaining.`);
                }
                onSuccess();
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Invalid verification code');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md"
            >
                <Card>
                    <CardHeader>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                                <Shield className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div>
                                <CardTitle>Two-Factor Authentication</CardTitle>
                                <CardDescription>
                                    {useBackupCode ? 'Enter a backup code' : 'Enter the code from your authenticator app'}
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}

                        <div>
                            <Input
                                type="text"
                                placeholder={useBackupCode ? "XXXXXXXX" : "000000"}
                                value={code}
                                onChange={(e) => {
                                    const value = useBackupCode 
                                        ? e.target.value.toUpperCase().slice(0, 8)
                                        : e.target.value.replace(/\D/g, '').slice(0, 6);
                                    setCode(value);
                                }}
                                maxLength={useBackupCode ? 8 : 6}
                                className="text-center text-2xl font-mono tracking-widest"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && code.length >= 6) {
                                        handleVerify();
                                    }
                                }}
                            />
                        </div>

                        <Button
                            onClick={handleVerify}
                            disabled={code.length < (useBackupCode ? 8 : 6) || loading}
                            className="w-full"
                        >
                            {loading ? 'Verifying...' : 'Verify'}
                        </Button>

                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => {
                                    setUseBackupCode(!useBackupCode);
                                    setCode('');
                                    setError('');
                                }}
                                className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center justify-center gap-2 mx-auto"
                            >
                                <Key className="w-4 h-4" />
                                {useBackupCode ? 'Use authenticator code' : 'Use backup code instead'}
                            </button>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    );
}