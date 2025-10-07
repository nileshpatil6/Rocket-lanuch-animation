import React from 'react';
import type { MissionData, CameraAngle } from '../App';

interface UIOverlayProps {
  loading: boolean;
  scrollPercent: number;
  missionData: MissionData;
  cameraAngle: CameraAngle;
  setCameraAngle: (angle: CameraAngle) => void;
  autoScroll: boolean;
  toggleAutoScroll: () => void;
}

const UIOverlay: React.FC<UIOverlayProps> = ({ loading, scrollPercent, missionData, cameraAngle, setCameraAngle, autoScroll, toggleAutoScroll }) => {
  const getCountdown = () => {
    if (scrollPercent < 10) return 'T-00:00:10';
    if (scrollPercent < 25) {
      const countdownProgress = (scrollPercent - 10) / 15;
      const countdown = 10 - Math.floor(countdownProgress * 10);
      return `T-00:00:${countdown.toString().padStart(2, '0')}`;
    }
    return 'LIFTOFF';
  };

  if (loading) {
    return (
      <div className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-80 flex flex-col justify-center items-center z-20">
        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-cyan-400"></div>
        <p className="mt-4 text-lg text-cyan-200">Loading High-Resolution Textures...</p>
      </div>
    );
  }

  const cameraOptions: { id: CameraAngle; label: string }[] = [
    { id: 'cinematic', label: 'Cinematic' },
    { id: 'follow', label: 'Follow Cam' },
    { id: 'wide', label: 'Wide Angle' },
  ];

  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-10 p-8 text-white font-mono flex flex-col justify-between">
      {/* Top Left Info */}
      <div>
        <h1 className="text-3xl font-bold text-cyan-300">SATELLITE LAUNCH SIM</h1>
        <p className="text-lg">Mission: Orbit Insertion</p>
      </div>

      {/* Top Right Camera Controls */}
      <div className="absolute top-8 right-24 flex flex-col gap-2 pointer-events-auto">
        {/* Auto Scroll Button */}
        <button
          onClick={toggleAutoScroll}
          className={`px-3 py-1 text-sm rounded-md transition-colors border border-gray-700 backdrop-blur-sm ${
            autoScroll
              ? 'bg-green-500 text-black font-bold animate-pulse'
              : 'bg-black bg-opacity-40 hover:bg-gray-800'
          }`}
        >
          {autoScroll ? '⏸ Auto' : '▶ Auto'}
        </button>
        
        {/* Camera Angle Buttons */}
        {cameraOptions.map((option) => (
          <button
            key={option.id}
            onClick={() => setCameraAngle(option.id)}
            className={`px-3 py-1 text-sm rounded-md transition-colors border border-gray-700 backdrop-blur-sm ${
              cameraAngle === option.id
                ? 'bg-cyan-500 text-black font-bold'
                : 'bg-black bg-opacity-40 hover:bg-gray-800'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      
      {/* Scroll Progress Bar on the right */}
      <div className="absolute top-1/2 right-8 -translate-y-1/2 flex flex-col items-center">
        <div className="h-64 w-1 bg-gray-700 rounded-full">
          <div 
            className="w-full bg-cyan-400 rounded-full" 
            style={{ height: `${scrollPercent}%` }}
          />
        </div>
        <p className="mt-4 text-sm">{scrollPercent.toFixed(0)}%</p>
      </div>

      {/* Bottom Center Info */}
      <div className="w-full flex justify-center">
        <div className="bg-black bg-opacity-50 backdrop-blur-sm p-4 rounded-lg text-center border border-gray-700 max-w-lg">
          <h2 className="text-xl text-cyan-400">Phase: {missionData.phase}</h2>
          <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-400">Altitude</p>
              <p className="text-lg">{missionData.altitude.toFixed(0)} KM</p>
            </div>
            <div>
              <p className="text-gray-400">Velocity</p>
              <p className="text-lg">{missionData.velocity.toFixed(2)} KM/s</p>
            </div>
            <div>
              <p className="text-gray-400">Countdown</p>
              <p className="text-lg">{getCountdown()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Exploration Notification - Minimalistic corner note */}
      {scrollPercent >= 95 && (
        <div className="absolute bottom-24 right-8 pointer-events-auto">
          <div className="bg-black bg-opacity-40 backdrop-blur-md p-4 rounded-lg border border-cyan-500 border-opacity-30 max-w-xs">
            <div className="flex items-start gap-3">
              <div className="text-2xl">🛰️</div>
              <div>
                <p className="text-sm text-green-400 leading-relaxed">
                  Mission complete. Click Earth or Satellite to explore Terra data.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UIOverlay;
