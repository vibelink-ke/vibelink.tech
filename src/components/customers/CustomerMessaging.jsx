import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageSquare, Send, Phone, Mail, User, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CustomerMessaging({ customerId, ticketId, customerName }) {
    const [message, setMessage] = useState('');
    const [messages, setMessages] = useState([
        { id: 1, text: `Hello ${customerName}, how can we help you today?`, sender: 'agent', time: '10:00 AM' },
        { id: 2, text: "I'm having trouble with my connection speed.", sender: 'customer', time: '10:05 AM' }
    ]);

    const handleSend = () => {
        if (!message.trim()) return;
        const newMessage = {
            id: messages.length + 1,
            text: message,
            sender: 'agent',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages([...messages, newMessage]);
        setMessage('');
    };

    return (
        <Card className="flex flex-col h-[600px] border-none shadow-xl overflow-hidden bg-white">
            <CardHeader className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white p-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-md">
                            <User className="w-6 h-6" />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-bold">{customerName || 'Customer'}</CardTitle>
                            <div className="flex items-center gap-2 text-indigo-100 text-sm mt-1">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                Online • Ticket #{ticketId || 'N/A'}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
                            <Phone className="w-5 h-5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
                            <Mail className="w-5 h-5" />
                        </Button>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50">
                <AnimatePresence>
                    {messages.map((msg) => (
                        <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            className={`flex ${msg.sender === 'agent' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div className={`max-w-[80%] p-4 rounded-2xl shadow-sm ${
                                msg.sender === 'agent' 
                                ? 'bg-indigo-600 text-white rounded-tr-none' 
                                : 'bg-white text-slate-800 rounded-tl-none border border-slate-100'
                            }`}>
                                <p className="text-sm leading-relaxed">{msg.text}</p>
                                <span className={`text-[10px] block mt-2 opacity-60 ${
                                    msg.sender === 'agent' ? 'text-right' : 'text-left'
                                }`}>
                                    {msg.time}
                                </span>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </CardContent>

            <div className="p-4 bg-white border-t border-slate-100">
                <div className="flex gap-3">
                    <div className="flex-1 relative">
                        <Input 
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Type your message..."
                            className="pr-12 bg-slate-50 border-none focus-visible:ring-indigo-500 h-12"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-slate-300" />
                        </div>
                    </div>
                    <Button 
                        onClick={handleSend}
                        className="h-12 w-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100 p-0"
                    >
                        <Send className="w-5 h-5" />
                    </Button>
                </div>
            </div>
        </Card>
    );
}
