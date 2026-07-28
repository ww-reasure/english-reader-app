/**
 * Shared first-run reading material. Keeping it outside the DOM view lets the
 * offline lexicon build test protect the actual calibration experience from
 * silent losses in common-word and inflection coverage.
 */
export const CALIBRATION_SHORT_READING = Object.freeze({
  title: 'A Small Change at the Coast',
  content: `A coastal town once treated its beach as a place that would clean itself. During busy weekends, visitors left bottles and food containers behind. A group of students began recording what they found after each weekend. Their records showed that most waste came from only a few kinds of packaging. The town then placed refill stations near the beach and asked local shops to offer reusable cups. Six months later, the students found less plastic in the sand. The project did not solve every problem, but it gave residents clear evidence that a practical change could protect a shared place.`,
  questions: [
    { question: 'Why did the students make records after weekends?', options: ['To choose a new beach', 'To identify where most waste came from', 'To sell reusable cups', 'To close local shops'], answer: 1 },
    { question: 'What changed after the town acted?', options: ['The beach became larger', 'Visitors stopped using water', 'Less plastic was found in the sand', 'Students stopped recording'], answer: 2 },
    { question: 'What is the main point of the passage?', options: ['Small evidence-based actions can improve a shared environment', 'Only students can protect beaches', 'Packaging should always be banned', 'Tourism always harms coastal towns'], answer: 0 }
  ]
});
