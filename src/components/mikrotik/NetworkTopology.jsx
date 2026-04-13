import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function NetworkTopology({ routers, onSelectRouter }) {
  const canvasRef = useRef(null);
  const [hoveredRouter, setHoveredRouter] = useState(null);
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [nodes, setNodes] = useState([]);

  // Initialize nodes with force-directed layout
  useEffect(() => {
    if (routers.length === 0) return;

    // Create initial node positions
    const initialNodes = routers.map((router, idx) => {
      const angle = (idx / routers.length) * Math.PI * 2;
      const radius = 200;
      return {
        id: router.id,
        router,
        x: 300 + radius * Math.cos(angle),
        y: 300 + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });

    setNodes(initialNodes);
  }, [routers]);

  // Simulate force-directed graph
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const ctx = canvas.getContext('2d');
    let animationId;

    const simulate = () => {
      // Update positions
      const updatedNodes = nodes.map(node => {
        let fx = 0;
        let fy = 0;

        // Repulsive forces
        nodes.forEach(other => {
          if (node.id === other.id) return;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 50000 / (dist * dist);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        });

        // Attractive forces (to center)
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const dx = centerX - node.x;
        const dy = centerY - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        fx += (dx / dist) * 10;
        fy += (dy / dist) * 10;

        // Update velocity and position
        const newVx = (node.vx + fx * 0.01) * 0.95;
        const newVy = (node.vy + fy * 0.01) * 0.95;
        const newX = Math.max(50, Math.min(canvas.width - 50, node.x + newVx));
        const newY = Math.max(50, Math.min(canvas.height - 50, node.y + newVy));

        return {
          ...node,
          x: newX,
          y: newY,
          vx: newVx,
          vy: newVy,
        };
      });

      setNodes(updatedNodes);

      // Draw
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw connections
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      updatedNodes.forEach(node => {
        updatedNodes.forEach(other => {
          if (node.id === other.id) return;
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(other.x, other.y);
          ctx.stroke();
        });
      });

      // Draw nodes
      updatedNodes.forEach(node => {
        const isOnline = node.router.status === 'online';
        const hasAlert = node.router.cpu_usage >= 80 || node.router.memory_usage >= 80;

        // Node circle
        ctx.fillStyle = hasAlert ? '#fca5a5' : isOnline ? '#10b981' : '#e2e8f0';
        ctx.beginPath();
        ctx.arc(node.x, node.y, 25, 0, Math.PI * 2);
        ctx.fill();

        // Glow effect
        if (node.id === selectedRouter) {
          ctx.strokeStyle = '#4f46e5';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(node.x, node.y, 28, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Icon
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isOnline ? '◉' : '◯', node.x, node.y);
      });

      animationId = requestAnimationFrame(simulate);
    };

    simulate();

    return () => cancelAnimationFrame(animationId);
  }, [nodes, selectedRouter]);

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if click is on a node
    const clickedNode = nodes.find(node => {
      const dist = Math.sqrt((node.x - x) ** 2 + (node.y - y) ** 2);
      return dist <= 25;
    });

    if (clickedNode) {
      setSelectedRouter(clickedNode.id);
      onSelectRouter(clickedNode.router);
    }
  };

  const handleCanvasMouseMove = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hoveredNode = nodes.find(node => {
      const dist = Math.sqrt((node.x - x) ** 2 + (node.y - y) ** 2);
      return dist <= 25;
    });

    setHoveredRouter(hoveredNode?.id || null);
    canvas.style.cursor = hoveredNode ? 'pointer' : 'default';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="w-5 h-5" />
            Network Topology
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-emerald-500" />
              <span className="text-xs text-slate-600 dark:text-slate-400">Online</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-slate-400" />
              <span className="text-xs text-slate-600 dark:text-slate-400">Offline</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-red-400" />
              <span className="text-xs text-slate-600 dark:text-slate-400">Alert</span>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
            <canvas
              ref={canvasRef}
              width={800}
              height={500}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
              className="w-full"
            />
          </div>

          {/* Device List */}
          {routers.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Devices ({routers.length})</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {routers.map(router => {
                  const isSelected = router.id === selectedRouter;
                  const isHovered = router.id === hoveredRouter;
                  const isOnline = router.status === 'online';
                  const hasAlert = router.cpu_usage >= 80 || router.memory_usage >= 80;

                  return (
                    <motion.div
                      key={router.id}
                      onClick={() => {
                        setSelectedRouter(router.id);
                        onSelectRouter(router);
                      }}
                      whileHover={{ scale: 1.02 }}
                      className={cn(
                        'p-3 rounded-lg border-2 cursor-pointer transition-all',
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50'
                          : isHovered
                          ? 'border-slate-300 bg-slate-50 dark:bg-slate-800/50'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-1">
                          {isOnline ? (
                            <Wifi className={cn('w-4 h-4', hasAlert ? 'text-red-500' : 'text-emerald-500')} />
                          ) : (
                            <WifiOff className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{router.router_name}</p>
                          <p className="text-xs text-slate-600 dark:text-slate-400">{router.ip_address}</p>
                          <div className="flex gap-1 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {router.status}
                            </Badge>
                            {hasAlert && (
                              <Badge variant="outline" className="text-xs bg-red-50 border-red-200 text-red-700">
                                Alert
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}