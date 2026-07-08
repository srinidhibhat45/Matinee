document.addEventListener('DOMContentLoaded', () => {
    // ----------------------------------------------------
    // 1. Hero Image Auto-Rotation
    // ----------------------------------------------------
    const phoneScreen = document.getElementById('phone-preview-img');
    const rotationImages = [
        'assets/screenshots/matinee_splash_1781721602953.png',
        'assets/screenshots/media__1781807966306.png', // Recommendations feed
        'assets/screenshots/media__1781780463750.png', // Movie Details
        'assets/screenshots/media__1782154185512.png', // Notification drawer
        'assets/screenshots/media__1782154315260.png'  // Activity/Ratings stats
    ];
    let currentRotationIdx = 0;

    setInterval(() => {
        phoneScreen.classList.remove('active');
        
        setTimeout(() => {
            currentRotationIdx = (currentRotationIdx + 1) % rotationImages.length;
            phoneScreen.src = rotationImages[currentRotationIdx];
            phoneScreen.classList.add('active');
        }, 500);
    }, 4500);

    // ----------------------------------------------------
    // 2. Screenshot Gallery Configuration & Loading
    // ----------------------------------------------------
    const screenshots = [
        { 
            file: 'media__1781807966306.png', 
            title: 'Personalized Recommendations Feed', 
            desc: 'Custom local discovery feed grouping recommended movie and TV series suggestions based on genre affinity and favorite directors.', 
            category: 'core' 
        },
        { 
            file: 'media__1781780463750.png', 
            title: 'Movie Detail Insights', 
            desc: 'High-fidelity details screen displaying TMDB movie information, full cast logs, and local Gemini AI Taste Match percentages.', 
            category: 'details' 
        },
        { 
            file: 'media__1782154185512.png', 
            title: 'In-App Notification Drawer', 
            desc: 'Real-time alert drawer displaying OTT availability updates and upcoming release counts matching local watchlist items.', 
            category: 'core' 
        },
        { 
            file: 'media__1782154315260.png', 
            title: 'Insights & Activity Heatmap', 
            desc: 'Statistical contribution dashboard displaying total movie/series watch logs per day, active watch streaks, and total hours.', 
            category: 'insights' 
        }
    ];

    const grid = document.getElementById('screenshots-grid');

    function renderScreenshots() {
        grid.innerHTML = '';
        screenshots.forEach(s => {
            const card = document.createElement('div');
            card.className = 'screenshot-card reveal visible';
            
            card.innerHTML = `
                <img src="assets/screenshots/${s.file}" alt="${s.title}">
                <div class="screenshot-info">
                    <h4>${s.title}</h4>
                    <p>${s.category.toUpperCase()}</p>
                </div>
            `;

            card.addEventListener('click', () => openLightbox(`assets/screenshots/${s.file}`, s.title, s.desc));
            grid.appendChild(card);
        });
    }

    // Initialize gallery
    renderScreenshots();

    // ----------------------------------------------------
    // 3. Lightbox Modal
    // ----------------------------------------------------
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    const lightboxClose = document.getElementById('lightbox-close');

    function openLightbox(src, title, desc) {
        lightboxImg.src = src;
        lightboxCaption.innerHTML = `<strong>${title}</strong><br><span style="font-size:0.9rem;color:#9CA3AF">${desc}</span>`;
        lightbox.classList.add('show');
    }

    function closeLightbox() {
        lightbox.classList.remove('show');
    }

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox || e.target === lightboxClose) {
            closeLightbox();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLightbox();
    });

    // ----------------------------------------------------
    // 4. Taste Match Simulator Dataset & Logic
    // ----------------------------------------------------
    const simulatorDatabase = {
        'mind-bending': {
            'golden': {
                title: '2001: A Space Odyssey',
                year: '1968',
                genres: 'Sci-Fi, Adventure',
                runtime: '149 mins',
                director: 'Stanley Kubrick',
                score: '98%',
                insight: 'The ultimate mind-bending epic. Your preference for experimental cinematography and high-concept cosmic philosophy maps perfectly to Kubrick’s genre-defining masterpiece.'
            },
            'millennium': {
                title: 'Memento',
                year: '2000',
                genres: 'Mystery, Thriller',
                runtime: '113 mins',
                director: 'Christopher Nolan',
                score: '97%',
                insight: 'Since Christopher Nolan is in your top loved directors, this reverse-chronological noir mystery aligns with your preference for puzzle-box narratives.'
            },
            'modern': {
                title: 'Inception',
                year: '2010',
                genres: 'Sci-Fi, Action, Thriller',
                runtime: '148 mins',
                director: 'Christopher Nolan',
                score: '96%',
                insight: 'A quintessential modern mind-bending heist. Matches your high rating of interstellar concepts, blending dream architectures with high stakes and deep emotional resonance.'
            },
            'brand-new': {
                title: 'Everything Everywhere All at Once',
                year: '2022',
                genres: 'Sci-Fi, Action, Comedy',
                runtime: '139 mins',
                director: 'Daniel Kwan, Daniel Scheinert',
                score: '94%',
                insight: 'An explosive multiverse exploration that breaks conventional narratives. Ideal for your taste in deep family dynamics masked inside chaotic, mind-bending setups.'
            }
        },
        'action': {
            'golden': {
                title: 'Seven Samurai',
                year: '1954',
                genres: 'Action, Drama',
                runtime: '207 mins',
                director: 'Akira Kurosawa',
                score: '99%',
                insight: 'The blueprint for modern action cinema. Your high affinity for ensemble tactical stories and classic film grammar points directly to Kurosawa’s monumental epic.'
            },
            'millennium': {
                title: 'The Matrix',
                year: '1999',
                genres: 'Sci-Fi, Action',
                runtime: '136 mins',
                director: 'Lana Wachowski, Lilly Wachowski',
                score: '97%',
                insight: 'Perfect harmony of style and wire-fu action. Your history of logging sci-fi thrillers boosts this cyberpunk classic to a near-perfect match.'
            },
            'modern': {
                title: 'Mad Max: Fury Road',
                year: '2015',
                genres: 'Action, Sci-Fi, Adventure',
                runtime: '120 mins',
                director: 'George Miller',
                score: '96%',
                insight: 'A relentless two-hour visual chase. High-octane stunts and minimal CGI make this high-speed desert war a masterpiece of modern kinetic action.'
            },
            'brand-new': {
                title: 'Dune: Part Two',
                year: '2024',
                genres: 'Sci-Fi, Adventure, Action',
                runtime: '166 mins',
                director: 'Denis Villeneuve',
                score: '95%',
                insight: 'An epic sandstorm of scale and political drama. Perfect for your modern sci-fi preference list, delivering heavy tactical battles and state-of-the-art sound design.'
            }
        },
        'emotional': {
            'golden': {
                title: 'Tokyo Story',
                year: '1953',
                genres: 'Drama',
                runtime: '136 mins',
                director: 'Yasujiro Ozu',
                score: '96%',
                insight: 'A quiet, devastatingly beautiful examination of generational divides and family dynamics. Aligns with your high appreciation for emotional character-driven stories.'
            },
            'millennium': {
                title: 'Magnolia',
                year: '1999',
                genres: 'Drama',
                runtime: '188 mins',
                director: 'Paul Thomas Anderson',
                score: '93%',
                insight: 'A sprawling mosaic of grief, alienation, and forgiveness. Matches your history of rating complex ensemble dramas highly.'
            },
            'modern': {
                title: 'Interstellar',
                year: '2014',
                genres: 'Sci-Fi, Drama',
                runtime: '169 mins',
                director: 'Christopher Nolan',
                score: '98%',
                insight: 'Your profile scores suggest high resonance with narratives combining cosmic scale and father-daughter relationship dynamics, elevated by Zimmer’s iconic organ chords.'
            },
            'brand-new': {
                title: 'Past Lives',
                year: '2023',
                genres: 'Drama, Romance',
                runtime: '105 mins',
                director: 'Celine Song',
                score: '95%',
                insight: 'A modern masterpiece about fate (In-Yun), missed connections, and growing up. Leverages your preference for intimate, dialogue-rich indie cinema.'
            }
        },
        'cozy': {
            'golden': {
                title: 'Singin\' in the Rain',
                year: '1952',
                genres: 'Comedy, Romance, Musical',
                runtime: '103 mins',
                director: 'Gene Kelly, Stanley Donen',
                score: '94%',
                insight: 'The ultimate feel-good cinema celebration. Its infectious charm, physical comedy, and colorful production values match your lighthearted watch history.'
            },
            'millennium': {
                title: 'Amélie',
                year: '2001',
                genres: 'Comedy, Romance',
                runtime: '122 mins',
                director: 'Jean-Pierre Jeunet',
                score: '93%',
                insight: 'A quirky, visually saturated French comedy that celebrates life’s smallest details. Highly recommended for a warm, cozy evening watch.'
            },
            'modern': {
                title: 'The Grand Budapest Hotel',
                year: '2014',
                genres: 'Comedy, Drama',
                runtime: '99 mins',
                director: 'Wes Anderson',
                score: '95%',
                insight: 'Wes Anderson’s diorama-like symmetry, whimsical storytelling, and fast-paced humor align with your preference for premium art direction.'
            },
            'brand-new': {
                title: 'Perfect Days',
                year: '2023',
                genres: 'Drama',
                runtime: '124 mins',
                director: 'Wim Wenders',
                score: '92%',
                insight: 'A peaceful, structure-rich look at the daily routines of a Tokyo toilet cleaner. A beautiful, comforting film celebrating simplicity and analog cassette music.'
            }
        },
        'dark': {
            'golden': {
                title: 'Psycho',
                year: '1960',
                genres: 'Horror, Mystery, Thriller',
                runtime: '109 mins',
                director: 'Alfred Hitchcock',
                score: '97%',
                insight: 'Hitchcock’s legendary thriller matches your preference for suspense and classic horror. The jarring score and stark cinematography make it a timeless masterpiece.'
            },
            'millennium': {
                title: 'Fight Club',
                year: '1999',
                genres: 'Drama, Thriller',
                runtime: '139 mins',
                director: 'David Fincher',
                score: '96%',
                insight: 'Dark, cynical, and stylishly directed by Fincher (whose crime filmography is heavily weighted in your preferences). Blends anti-consumerist philosophy with thriller twists.'
            },
            'modern': {
                title: 'Nightcrawler',
                year: '2014',
                genres: 'Crime, Thriller, Drama',
                runtime: '117 mins',
                director: 'Dan Gilroy',
                score: '94%',
                insight: 'A cold, neon-soaked study of media sensationalism and psychopathy. Aligns with your dark thriller rating signals and Jake Gyllenhaal’s performance history.'
            },
            'brand-new': {
                title: 'The Batman',
                year: '2022',
                genres: 'Action, Crime, Mystery',
                runtime: '176 mins',
                director: 'Matt Reeves',
                score: '93%',
                insight: 'A rain-slicked, shadow-heavy detective noir. Perfect match for a dark mood, featuring industrial scores and a focus on street-level crime investigation.'
            }
        }
    };

    // Setup Event Listeners for Chips
    function setupChipSelect(groupId) {
        const container = document.getElementById(groupId);
        const chips = container.querySelectorAll('.chip');
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                chips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            });
        });
    }

    setupChipSelect('sim-vibe');
    setupChipSelect('sim-era');
    setupChipSelect('sim-duration');

    const generateBtn = document.getElementById('sim-generate-btn');
    const recCard = document.getElementById('recommendation-card');

    generateBtn.addEventListener('click', () => {
        const vibe = document.getElementById('sim-vibe').querySelector('.chip.active').dataset.value;
        const era = document.getElementById('sim-era').querySelector('.chip.active').dataset.value;
        const duration = document.getElementById('sim-duration').querySelector('.chip.active').dataset.value;

        const matchData = simulatorDatabase[vibe][era];

        recCard.style.opacity = '0';
        recCard.style.transform = 'translateY(10px)';

        setTimeout(() => {
            document.getElementById('rec-title').textContent = matchData.title;
            document.getElementById('rec-year').textContent = matchData.year;
            document.getElementById('rec-genres').textContent = matchData.genres;
            
            let runtimeStr = matchData.runtime;
            if (duration === 'short' && parseInt(matchData.runtime) > 110) {
                runtimeStr = '95 mins (Edited Cut)';
            } else if (duration === 'epic' && parseInt(matchData.runtime) < 130) {
                runtimeStr = '154 mins (Director\'s Cut)';
            }
            document.getElementById('rec-runtime').textContent = runtimeStr;
            
            document.getElementById('rec-director').textContent = matchData.director;
            document.getElementById('rec-score').textContent = matchData.score;
            document.getElementById('rec-insight').textContent = `"${matchData.insight}"`;

            recCard.style.opacity = '1';
            recCard.style.transform = 'translateY(0)';
        }, 300);
    });

    recCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

    // ----------------------------------------------------
    // 5. Scroll Reveal Animations
    // ----------------------------------------------------
    const revealElements = document.querySelectorAll('.reveal');

    const revealOnScroll = () => {
        const triggerBottom = (window.innerHeight / 10) * 9.5;
        
        revealElements.forEach(el => {
            const elTop = el.getBoundingClientRect().top;
            if (elTop < triggerBottom) {
                el.classList.add('visible');
            } else {
                el.classList.remove('visible');
            }
        });
    };

    window.addEventListener('scroll', revealOnScroll);
    revealOnScroll();

    // ----------------------------------------------------
    // 6. Password Protection Logic
    // ----------------------------------------------------
    const passwordOverlay = document.getElementById('password-overlay');
    const passwordForm = document.getElementById('password-form');
    const passwordInput = document.getElementById('password-input');
    const passwordError = document.getElementById('password-error');

    // Check if already unlocked in this session
    if (sessionStorage.getItem('matinee_unlocked') === 'true') {
        passwordOverlay.classList.add('hidden');
    } else {
        // Prevent scroll on body while locked
        document.body.style.overflow = 'hidden';
    }

    passwordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const enteredPassword = passwordInput.value;
        if (enteredPassword === 'qwerty12345') {
            sessionStorage.setItem('matinee_unlocked', 'true');
            passwordOverlay.classList.add('hidden');
            // Restore scrolling
            document.body.style.overflow = 'auto';
        } else {
            passwordError.textContent = 'Incorrect password. Please try again.';
            passwordInput.value = '';
            passwordInput.focus();
        }
    });
});

