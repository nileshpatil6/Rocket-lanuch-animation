import React, { useState, useCallback } from 'react';
import ThreeScene from './components/ThreeScene';
import UIOverlay from './components/UIOverlay';

export interface MissionData {
  phase: string;
  altitude: number;
  velocity: number;
}

export type CameraAngle = 'cinematic' | 'follow' | 'wide';

function App() {
  const [loading, setLoading] = useState(true);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [cameraAngle, setCameraAngle] = useState<CameraAngle>('cinematic');
  const [autoScroll, setAutoScroll] = useState(false);
  const [missionData, setMissionData] = useState<MissionData>({
    phase: 'Orbital Approach',
    altitude: 0,
    velocity: 0,
  });

  const handleSceneUpdate = useCallback((percent: number, data: MissionData) => {
    setScrollPercent(percent);
    setMissionData(data);
  }, []);

  const toggleAutoScroll = useCallback(() => {
    setAutoScroll(prev => !prev);
  }, []);

  // Auto-scroll effect with smooth easing
  React.useEffect(() => {
    if (!autoScroll) return;
    
    const scrollSpeed = 1.5; // Increased from 0.8 to 1.5 for better pacing
    let animationId: number;
    let velocity = 0;
    const maxVelocity = scrollSpeed;
    const acceleration = 0.03; // Slightly faster acceleration
    const deceleration = 0.98; // Smooth deceleration
    
    const autoScrollStep = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const currentScroll = window.scrollY;
      
      if (currentScroll < maxScroll) {
        // Smooth acceleration
        velocity = Math.min(velocity + acceleration, maxVelocity);
        
        // Apply smooth easing
        const easedVelocity = velocity * deceleration;
        window.scrollBy(0, easedVelocity);
        
        animationId = requestAnimationFrame(autoScrollStep);
      } else {
        // Reset to beginning when reaching end
        setAutoScroll(false);
        velocity = 0;
      }
    };
    
    animationId = requestAnimationFrame(autoScrollStep);
    
    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      velocity = 0;
    };
  }, [autoScroll]);

  return (
    <main className="bg-black text-white h-full w-full">
      {/* This div creates the scrollable space */}
      <div style={{ height: '800vh' }} />

      <div className="fixed top-0 left-0 w-full h-full">
        <ThreeScene 
          setLoading={setLoading}
          onSceneUpdate={handleSceneUpdate}
          cameraAngle={cameraAngle}
        />
        <UIOverlay 
          loading={loading}
          scrollPercent={scrollPercent}
          missionData={missionData}
          cameraAngle={cameraAngle}
          setCameraAngle={setCameraAngle}
          autoScroll={autoScroll}
          toggleAutoScroll={toggleAutoScroll}
        />
      </div>
    </main>
  );
}

export default App;
