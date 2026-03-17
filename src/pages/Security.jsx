import React, { useState, useEffect } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import PageHeader from '@/components/shared/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Shield, CheckCircle2, XCircle, Key, RefreshCw, Download, Copy, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import TwoFactorSetup from '@/components/auth/TwoFactorSetup';

export default function Security() {
    const [user, setUser] = useState(null);
    const [showSetup, setShowSetup] = useState(false);
    const [showDisable, setShowDisable] = useState(false);
    const [showRegenerateBackup, setShowRegenerateBackup] = useState(false);
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [newBackupCodes, setNewBackupCodes] = useState(null);

    useEffect(() => {
        loadUser();
    }, []);

    const loadUser = async () => {
        const currentUser = await vibelink.auth.me();
        setUser(currentUser);
    };

    const handleDisable2FA = async () => {
        try {
            setLoading(true);
            await vibelink.functions.invoke('disable2FA', { password });
            toast.success('2FA disabled successfully');
            setShowDisable(false);
            setPassword('');
            await loadUser();
        } catch (err) {
            toast.error(err.response?.data?.error || 'Failed to disable 2FA');
        } finally {
            setLoading(false);
        }
    };

    const handleRegenerateBackupCodes = async () => {
        try {
            setLoading(true);
            const { data } = await vibelink.functions.invoke('regenerateBackupCodes', { password });
            setNewBackupCodes(data.backupCodes);
            toast.success('Backup codes regenerated');
            setPassword('');
        } catch (err) {
            toast.error(err.response?.data?.error || 'Failed to regenerate backup codes');
        } finally {
            setLoading(false);
        }
    };

    const downloadBackupCodes = (codes) => {
        const text = `VIBELINK 2FA Backup Codes\n\nSave these codes in a secure location.\nEach code can only be used once.\n\n${codes.join('\n')}`;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vibelink-backup-codes.txt';
        a.click();
        URL.revokeObjectURL(url);
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    };

    if (!user) {
        return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
    }

    return (
        <div className="p-6 space-y-6">
            <PageHeader
                title="Security Settings"
                subtitle="Manage your account security and two-factor authentication"
            />

            <div className="grid gap-6 max-w-4xl">
                {/* 2FA Status Card */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                    user.two_factor_enabled ? 'bg-green-100' : 'bg-slate-100'
                                }`}>
                                    <Shield className={`w-5 h-5 ${
                                        user.two_factor_enabled ? 'text-green-600' : 'text-slate-400'
                                    }`} />
                                </div>
                                <div>
                                    <CardTitle>Two-Factor Authentication</CardTitle>
                                    <CardDescription>
                                        Add an extra layer of security to your account
                                    </CardDescription>
                                </div>
                            </div>
                            {user.two_factor_enabled ? (
                                <Badge variant="default" className="bg-green-600">
                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                    Enabled
                                </Badge>
                            ) : (
                                <Badge variant="secondary">
                                    <XCircle className="w-3 h-3 mr-1" />
                                    Disabled
                                </Badge>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {user.role === 'admin' || user.role === 'super_admin' ? (
                            <Alert>
                                <AlertTriangle className="w-4 h-4" />
                                <AlertDescription>
                                    As an administrator, we strongly recommend enabling 2FA to protect your account.
                                </AlertDescription>
                            </Alert>
                        ) : null}

                        {user.two_factor_enabled ? (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-sm text-slate-600">
                                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                                    <span>Method: {user.two_factor_method === 'authenticator' ? 'Authenticator App' : 'SMS'}</span>
                                </div>
                                {user.two_factor_backup_codes && (
                                    <div className="flex items-center gap-2 text-sm text-slate-600">
                                        <Key className="w-4 h-4" />
                                        <span>{user.two_factor_backup_codes.length} backup codes remaining</span>
                                    </div>
                                )}
                                <div className="flex gap-3">
                                    <Button
                                        variant="outline"
                                        onClick={() => setShowRegenerateBackup(true)}
                                    >
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                        Regenerate Backup Codes
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        onClick={() => setShowDisable(true)}
                                    >
                                        Disable 2FA
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <Button onClick={() => setShowSetup(true)}>
                                <Shield className="w-4 h-4 mr-2" />
                                Enable Two-Factor Authentication
                            </Button>
                        )}
                    </CardContent>
                </Card>

                {/* Security Tips */}
                <Card>
                    <CardHeader>
                        <CardTitle>Security Best Practices</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-2 text-sm text-slate-600">
                            <li className="flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                                <span>Enable two-factor authentication for enhanced security</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                                <span>Store your backup codes in a secure location</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                                <span>Use a strong, unique password for your account</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                                <span>Review your account activity regularly</span>
                            </li>
                        </ul>
                    </CardContent>
                </Card>
            </div>

            {/* Setup Dialog */}
            <Dialog open={showSetup} onOpenChange={setShowSetup}>
                <DialogContent className="max-w-3xl">
                    <TwoFactorSetup
                        onComplete={() => {
                            setShowSetup(false);
                            loadUser();
                            toast.success('2FA enabled successfully');
                        }}
                    />
                </DialogContent>
            </Dialog>

            {/* Disable 2FA Dialog */}
            <Dialog open={showDisable} onOpenChange={setShowDisable}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <Alert variant="destructive">
                            <AlertDescription>
                                Disabling 2FA will make your account less secure. Are you sure you want to continue?
                            </AlertDescription>
                        </Alert>
                        <div>
                            <label className="text-sm font-medium mb-2 block">Enter your password to confirm</label>
                            <Input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                            />
                        </div>
                        <div className="flex gap-3">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setShowDisable(false);
                                    setPassword('');
                                }}
                                className="flex-1"
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleDisable2FA}
                                disabled={!password || loading}
                                className="flex-1"
                            >
                                {loading ? 'Disabling...' : 'Disable 2FA'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Regenerate Backup Codes Dialog */}
            <Dialog open={showRegenerateBackup} onOpenChange={(open) => {
                setShowRegenerateBackup(open);
                if (!open) {
                    setNewBackupCodes(null);
                    setPassword('');
                }
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Regenerate Backup Codes</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        {!newBackupCodes ? (
                            <>
                                <Alert>
                                    <AlertDescription>
                                        This will invalidate your old backup codes and generate new ones.
                                    </AlertDescription>
                                </Alert>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">Enter your password to confirm</label>
                                    <Input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Password"
                                    />
                                </div>
                                <div className="flex gap-3">
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setShowRegenerateBackup(false);
                                            setPassword('');
                                        }}
                                        className="flex-1"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handleRegenerateBackupCodes}
                                        disabled={!password || loading}
                                        className="flex-1"
                                    >
                                        {loading ? 'Generating...' : 'Generate New Codes'}
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <>
                                <Alert>
                                    <AlertDescription>
                                        Save these new backup codes in a secure location. Your old codes are now invalid.
                                    </AlertDescription>
                                </Alert>
                                <div className="bg-slate-50 rounded-lg p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="font-semibold text-sm">New Backup Codes</h3>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => downloadBackupCodes(newBackupCodes)}
                                        >
                                            <Download className="w-4 h-4 mr-2" />
                                            Download
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {newBackupCodes.map((code, idx) => (
                                            <div
                                                key={idx}
                                                className="bg-white px-3 py-2 rounded border font-mono text-xs flex items-center justify-between"
                                            >
                                                <span>{code}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6"
                                                    onClick={() => copyToClipboard(code)}
                                                >
                                                    <Copy className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <Button
                                    onClick={() => {
                                        setShowRegenerateBackup(false);
                                        setNewBackupCodes(null);
                                        loadUser();
                                    }}
                                    className="w-full"
                                >
                                    Done
                                </Button>
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}