// Minimal script for ambient background effects
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('particles');
    if (!container) return;

    // Create floating particles for background ambiance
    for (let i = 0; i < 30; i++) {
        createParticle(container);
    }
});

function createParticle(container) {
    const particle = document.createElement('div');

    // Randomize properties
    const size = Math.random() * 4 + 1;
    const left = Math.random() * 100;
    const top = Math.random() * 100;
    const duration = Math.random() * 20 + 10;
    const delay = Math.random() * 5;

    // Styling
    particle.style.position = 'absolute';
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.background = Math.random() > 0.5 ? 'rgba(225, 6, 0, 0.3)' : 'rgba(0, 210, 254, 0.3)';
    particle.style.borderRadius = '50%';
    particle.style.left = `${left}vw`;
    particle.style.top = `${top}vh`;
    particle.style.opacity = '0';
    particle.style.boxShadow = `0 0 ${size * 2}px ${particle.style.background}`;
    particle.style.animation = `float ${duration}s ease-in-out ${delay}s infinite`;

    container.appendChild(particle);
}

// Add global styles for the particle animation
const style = document.createElement('style');
style.textContent = `
    @keyframes float {
        0%, 100% {
            transform: translateY(0) translateX(0);
            opacity: 0;
        }
        25% {
            opacity: 0.6;
        }
        50% {
            transform: translateY(-100px) translateX(20px);
            opacity: 0.8;
        }
        75% {
            opacity: 0.4;
        }
    }
    .particles {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        pointer-events: none;
        z-index: 0;
    }
`;
document.head.appendChild(style);
